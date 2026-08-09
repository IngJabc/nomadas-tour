-- ============================================================
-- 057_trip_events_rpc.sql
-- WKR-007 Fase 2 — Transactional trip RPCs (outbox emission)
--
-- Atomic mutation + outbox event in the same transaction, per the
-- approved design (§4.1 "RPC transaccional"). Each function is
-- SECURITY DEFINER, SET search_path = public, EXECUTE service_role
-- only (same posture as 037/047).
--
-- Events emitted (all tenant_id = NULL, aggregate_type = 'trip',
-- version 1, dedup_key deterministic per §9.1, ON CONFLICT DO
-- NOTHING without conflict target):
--
--   create_trip          -> trip.created.v1
--   update_trip(...)     -> trip.postponed.v1  (p_postpone + departure change)
--                        -> trip.updated.v1    (non-postpone edit with changes)
--   set_trip_status      -> trip.cancelled.v1 / trip.completed.v1
--   complete_trip        -> trip.completed.v1 / trip.auto_completed.v1
--   archive_trip         -> trip.archived.v1
--
-- Decision (entry audit): postpone_trip and update_trip from the
-- design table collapse into a single update_trip(p_postpone);
-- is_real_postpone = p_postpone AND departure_time actually changed,
-- mirroring superadmin.service.ts updateTrip (superadmin.service.ts:1043).
--
-- Scope guard: service-layer context/duplicate validations
-- (assertNoDuplicateTrip, validateTripEditable, validateVehicleChange,
-- validateAgencyRemoval, validateNoActiveReservations, departure-in-
-- future) remain in the service. This migration only protects critical
-- DB invariants and race conditions (status transitions, unique
-- route+departure, seat integrity on capacity shrink, agency FK).
-- ============================================================

-- ── 0) Private emission helper ─────────────────────────────────
-- Single writer for trip.* outbox facts so every RPC shares the same
-- envelope + dedup discipline. ON CONFLICT DO NOTHING (no target) is
-- safe because idx_outbox_events_dedup_key_unique is partial on
-- dedup_key IS NOT NULL (migration 053).

CREATE OR REPLACE FUNCTION public.emit_trip_event(
  p_event_type TEXT,
  p_trip_id UUID,
  p_payload JSONB,
  p_dedup_key TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.outbox_events (
    event_type,
    event_version,
    aggregate_type,
    aggregate_id,
    tenant_id,
    payload,
    status,
    attempts,
    available_at,
    dedup_key
  ) VALUES (
    p_event_type,
    1,
    'trip',
    p_trip_id,
    NULL,
    p_payload,
    'pending',
    0,
    NOW(),
    p_dedup_key
  )
  ON CONFLICT DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.emit_trip_event(TEXT, UUID, JSONB, TEXT) IS
  'WKR-007 Fase 2: single outbox writer for trip.* facts (tenant_id NULL, aggregate trip).';

-- ── 1) create_trip ─────────────────────────────────────────────
-- Replaces superadmin.service.ts createTrip (superadmin.service.ts:375).
-- Emits trip.created.v1 in the same transaction.

CREATE OR REPLACE FUNCTION public.create_trip(
  p_route_id UUID,
  p_departure_time TIMESTAMPTZ,
  p_vehicle_type TEXT,
  p_agency_ids UUID[],
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_ids UUID[];
  v_capacity INTEGER;
  v_trip public.trips%ROWTYPE;
BEGIN
  IF p_agency_ids IS NULL OR cardinality(p_agency_ids) = 0 THEN
    RAISE EXCEPTION 'ERR_NO_AGENCIES: At least one agency is required';
  END IF;

  SELECT ARRAY(SELECT DISTINCT unnest(p_agency_ids) ORDER BY 1) INTO v_agency_ids;

  IF NOT EXISTS (SELECT 1 FROM routes WHERE id = p_route_id) THEN
    RAISE EXCEPTION 'ERR_ROUTE_NOT_FOUND: Route not found';
  END IF;

  v_capacity := CASE p_vehicle_type
    WHEN 'bus' THEN 31
    WHEN 'kia' THEN 10
    ELSE -1
  END;

  IF v_capacity = -1 THEN
    RAISE EXCEPTION 'ERR_INVALID_VEHICLE_TYPE: vehicle_type must be bus or kia';
  END IF;

  -- Unique(route_id, departure_time) protects the duplicate race
  -- (service pre-check assertNoDuplicateTrip stays in service).
  BEGIN
    INSERT INTO trips (route_id, departure_time, capacity, vehicle_type, status, created_by)
    VALUES (p_route_id, p_departure_time, v_capacity, p_vehicle_type, 'active', p_created_by)
    RETURNING * INTO v_trip;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_TRIP_DUPLICATE: Ya existe un viaje programado para esta ruta en la fecha y hora seleccionadas.';
  END;

  INSERT INTO seats (trip_id, seat_code, status)
  SELECT v_trip.id, 'A' || g, 'available'
  FROM generate_series(1, v_capacity) AS g;

  INSERT INTO trip_agencies (trip_id, agency_id)
  SELECT v_trip.id, unnest(v_agency_ids);

  PERFORM public.emit_trip_event(
    'trip.created',
    v_trip.id,
    jsonb_build_object(
      'trip_id', v_trip.id,
      'route_id', v_trip.route_id,
      'departure_time', v_trip.departure_time,
      'vehicle_type', v_trip.vehicle_type,
      'capacity', v_trip.capacity,
      'agency_ids', to_jsonb(v_agency_ids)
    ),
    'trip.created:' || v_trip.id::text
  );

  RETURN to_jsonb(v_trip);
END;
$$;

COMMENT ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID) IS
  'WKR-007 Fase 2: atomic trip create + seats + trip_agencies + trip.created.v1. SECURITY DEFINER; EXECUTE service_role only.';

-- ── 2) update_trip ─────────────────────────────────────────────
-- Replaces superadmin.service.ts updateTrip (superadmin.service.ts:1006).
-- Emits trip.postponed.v1 when p_postpone AND departure_time changed,
-- otherwise trip.updated.v1 when the edit actually changed something.
-- Seat adjust (capacity derive from vehicle_type) and agency diff are
-- atomic; excess-seat activity blocks shrinking.

CREATE OR REPLACE FUNCTION public.update_trip(
  p_trip_id UUID,
  p_route_id UUID,
  p_departure_time TIMESTAMPTZ,
  p_vehicle_type TEXT,
  p_agency_ids UUID[],
  p_postpone BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_agency_ids UUID[];
  v_current_agency_ids UUID[];
  v_removed UUID[];
  v_added UUID[];
  v_new_capacity INTEGER;
  v_old_capacity INTEGER;
  v_old_departure TIMESTAMPTZ;
  v_excess TEXT[];
  v_in_use INTEGER;
  v_pass_refs INTEGER;
  v_changed_fields TEXT[] := '{}';
  v_sorted_fields TEXT[] := '{}';
  v_fields_hash TEXT;
  v_real_postpone BOOLEAN;
  v_union_agency_ids UUID[];
  v_emitted_event TEXT := NULL;
BEGIN
  SELECT * INTO v_trip FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;

  -- Race guard: trip may have been completed/cancelled/archived after
  -- the service snapshot (validateTripEditable stays in the service).
  IF v_trip.status <> 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_ACTIVE: Trip is not active';
  END IF;

  IF p_agency_ids IS NULL OR cardinality(p_agency_ids) = 0 THEN
    RAISE EXCEPTION 'ERR_NO_AGENCIES: At least one agency is required';
  END IF;

  SELECT ARRAY(SELECT DISTINCT unnest(p_agency_ids) ORDER BY 1) INTO v_agency_ids;

  IF NOT EXISTS (SELECT 1 FROM routes WHERE id = p_route_id) THEN
    RAISE EXCEPTION 'ERR_ROUTE_NOT_FOUND: Route not found';
  END IF;

  v_new_capacity := CASE p_vehicle_type
    WHEN 'bus' THEN 31
    WHEN 'kia' THEN 10
    ELSE -1
  END;

  IF v_new_capacity = -1 THEN
    RAISE EXCEPTION 'ERR_INVALID_VEHICLE_TYPE: vehicle_type must be bus or kia';
  END IF;

  -- changed_fields (trip.updated payload)
  IF v_trip.route_id IS DISTINCT FROM p_route_id THEN
    v_changed_fields := array_append(v_changed_fields, 'route_id');
  END IF;
  IF v_trip.departure_time IS DISTINCT FROM p_departure_time THEN
    v_changed_fields := array_append(v_changed_fields, 'departure_time');
  END IF;
  IF v_trip.capacity IS DISTINCT FROM v_new_capacity THEN
    v_changed_fields := array_append(v_changed_fields, 'capacity');
  END IF;
  IF v_trip.vehicle_type IS DISTINCT FROM p_vehicle_type THEN
    v_changed_fields := array_append(v_changed_fields, 'vehicle_type');
  END IF;

  SELECT COALESCE(array_agg(agency_id ORDER BY agency_id), '{}'::uuid[])
  INTO v_current_agency_ids
  FROM trip_agencies
  WHERE trip_id = p_trip_id;

  IF NOT (v_current_agency_ids = v_agency_ids) THEN
    v_changed_fields := array_append(v_changed_fields, 'agency_ids');
  END IF;

  v_old_capacity := v_trip.capacity;
  v_old_departure := v_trip.departure_time;
  v_real_postpone := p_postpone AND (v_trip.departure_time IS DISTINCT FROM p_departure_time);

  BEGIN
    UPDATE trips
    SET route_id = p_route_id,
        departure_time = p_departure_time,
        capacity = v_new_capacity,
        vehicle_type = p_vehicle_type
    WHERE id = p_trip_id
    RETURNING * INTO v_trip;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_TRIP_DUPLICATE: Ya existe un viaje programado para esta ruta en la fecha y hora seleccionadas.';
  END;

  -- Seat adjust (mirrors superadmin.service.ts:1070-1148)
  IF v_new_capacity > v_old_capacity THEN
    INSERT INTO seats (trip_id, seat_code, status)
    SELECT p_trip_id, 'A' || g, 'available'
    FROM generate_series(v_old_capacity + 1, v_new_capacity) AS g
    ON CONFLICT (trip_id, seat_code) DO NOTHING;
  ELSIF v_new_capacity < v_old_capacity THEN
    v_excess := ARRAY(
      SELECT 'A' || g
      FROM generate_series(v_new_capacity + 1, v_old_capacity) AS g
    );

    SELECT count(*) INTO v_in_use
    FROM seats
    WHERE trip_id = p_trip_id
      AND seat_code = ANY(v_excess)
      AND status <> 'available';

    IF v_in_use > 0 THEN
      RAISE EXCEPTION 'ERR_SEATS_IN_USE: No se puede reducir capacidad: hay asientos con actividad';
    END IF;

    SELECT count(*) INTO v_pass_refs
    FROM reservation_passengers rp
    JOIN seats s ON s.id = rp.seat_id
    WHERE s.trip_id = p_trip_id
      AND s.seat_code = ANY(v_excess);

    IF v_pass_refs > 0 THEN
      RAISE EXCEPTION 'ERR_SEATS_IN_USE: No se puede reducir capacidad: hay pasajeros en esos asientos';
    END IF;

    DELETE FROM seats
    WHERE trip_id = p_trip_id
      AND seat_code = ANY(v_excess);
  END IF;

  -- Agency diff (mirrors superadmin.service.ts:1150-1181)
  v_removed := ARRAY(
    SELECT unnest(v_current_agency_ids)
    EXCEPT
    SELECT unnest(v_agency_ids)
  );
  v_added := ARRAY(
    SELECT unnest(v_agency_ids)
    EXCEPT
    SELECT unnest(v_current_agency_ids)
  );

  IF cardinality(v_removed) > 0 THEN
    DELETE FROM trip_agencies
    WHERE trip_id = p_trip_id
      AND agency_id = ANY(v_removed);
  END IF;

  IF cardinality(v_added) > 0 THEN
    INSERT INTO trip_agencies (trip_id, agency_id)
    SELECT p_trip_id, unnest(v_added);
  END IF;

  -- Emission
  IF v_real_postpone THEN
    UPDATE trips SET postponed_from = v_old_departure WHERE id = p_trip_id;

    v_union_agency_ids := ARRAY(
      SELECT DISTINCT unnest(v_current_agency_ids || v_agency_ids) ORDER BY 1
    );

    PERFORM public.emit_trip_event(
      'trip.postponed',
      p_trip_id,
      jsonb_build_object(
        'trip_id', p_trip_id,
        'route_id', p_route_id,
        'previous_departure_time', v_old_departure,
        'departure_time', p_departure_time,
        'agency_ids', to_jsonb(v_union_agency_ids)
      ),
      'trip.postponed:' || p_trip_id::text
        || ':' || to_char(v_old_departure AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        || ':' || to_char(p_departure_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
    v_emitted_event := 'trip.postponed';
  ELSE
    v_sorted_fields := ARRAY(
      SELECT unnest(v_changed_fields) ORDER BY 1
    );

    IF cardinality(v_sorted_fields) > 0 THEN
      v_fields_hash := md5(array_to_string(v_sorted_fields, ','));
      PERFORM public.emit_trip_event(
        'trip.updated',
        p_trip_id,
        jsonb_build_object(
          'trip_id', p_trip_id,
          'route_id', p_route_id,
          'departure_time', p_departure_time,
          'changed_fields', to_jsonb(v_sorted_fields),
          'agency_ids', to_jsonb(v_agency_ids)
        ),
        'trip.updated:' || p_trip_id::text || ':' || v_fields_hash
      );
      v_emitted_event := 'trip.updated';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'trip_id', p_trip_id,
    'action', CASE WHEN v_real_postpone THEN 'postponed' ELSE 'updated' END,
    'event_type', v_emitted_event,
    'changed_fields', to_jsonb(v_sorted_fields)
  );
END;
$$;

COMMENT ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN) IS
  'WKR-007 Fase 2: atomic trip edit (postpone or non-postpone) + seats + agencies + trip.postponed.v1 | trip.updated.v1. SECURITY DEFINER; EXECUTE service_role only.';

-- ── 3) set_trip_status ─────────────────────────────────────────
-- Replaces superadmin.service.ts updateTripStatus
-- (superadmin.service.ts:1370). Enforces the same time-window rules
-- (complete after departure, cancel before departure) inside the
-- transaction and releases seats on cancel.

CREATE OR REPLACE FUNCTION public.set_trip_status(
  p_trip_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_agency_ids UUID[];
BEGIN
  IF p_status NOT IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'ERR_INVALID_STATUS: status must be cancelled or completed';
  END IF;

  SELECT * INTO v_trip FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;

  IF v_trip.status = 'archived' THEN
    RAISE EXCEPTION 'ERR_TRIP_ARCHIVED: No se puede modificar un viaje archivado';
  END IF;

  IF v_trip.status <> 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_ACTIVE: Trip is not active';
  END IF;

  IF p_status = 'completed' THEN
    IF NOW() < v_trip.departure_time THEN
      RAISE EXCEPTION 'ERR_TRIP_NOT_DEPARTED: Cannot complete a trip before its departure time';
    END IF;
  ELSIF p_status = 'cancelled' THEN
    IF NOW() >= v_trip.departure_time THEN
      RAISE EXCEPTION 'ERR_TRIP_DEPARTED: Cannot cancel a trip after its departure time';
    END IF;
  END IF;

  UPDATE trips SET status = p_status WHERE id = p_trip_id;

  -- Release all seats when cancelled (mirrors superadmin.service.ts:1409-1416)
  IF p_status = 'cancelled' THEN
    UPDATE seats
    SET status = 'available', locked_by = NULL, locked_at = NULL
    WHERE trip_id = p_trip_id
      AND status IN ('locked', 'reserved', 'blocked');
  END IF;

  SELECT COALESCE(array_agg(agency_id ORDER BY agency_id), '{}'::uuid[])
  INTO v_agency_ids
  FROM trip_agencies
  WHERE trip_id = p_trip_id;

  PERFORM public.emit_trip_event(
    'trip.' || p_status,
    p_trip_id,
    jsonb_build_object(
      'trip_id', p_trip_id,
      'route_id', v_trip.route_id,
      'departure_time', v_trip.departure_time,
      'status', p_status,
      'agency_ids', to_jsonb(v_agency_ids)
    ),
    'trip.' || p_status || ':' || p_trip_id::text
  );

  RETURN jsonb_build_object('trip_id', p_trip_id, 'status', p_status);
END;
$$;

COMMENT ON FUNCTION public.set_trip_status(UUID, TEXT) IS
  'WKR-007 Fase 2: atomic trip cancelled/completed + seat release + trip.cancelled.v1 | trip.completed.v1. SECURITY DEFINER; EXECUTE service_role only.';

-- ── 4) complete_trip ───────────────────────────────────────────
-- Manual (superadmin) and system (completeExpiredTrips) completion.
-- p_source = 'manual' -> trip.completed.v1 (dedup trip.completed:{trip_id})
-- p_source = 'auto'   -> trip.auto_completed.v1 (dedup with occurred_at)

CREATE OR REPLACE FUNCTION public.complete_trip(
  p_trip_id UUID,
  p_source TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_agency_ids UUID[];
  v_event_type TEXT;
  v_dedup_key TEXT;
  v_payload JSONB;
BEGIN
  IF p_source NOT IN ('manual', 'auto') THEN
    RAISE EXCEPTION 'ERR_INVALID_SOURCE: source must be manual or auto';
  END IF;

  SELECT * INTO v_trip FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;

  IF v_trip.status <> 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_ACTIVE: Trip is not active';
  END IF;

  IF NOW() < v_trip.departure_time THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_DEPARTED: Cannot complete a trip before its departure time';
  END IF;

  UPDATE trips SET status = 'completed' WHERE id = p_trip_id;

  SELECT COALESCE(array_agg(agency_id ORDER BY agency_id), '{}'::uuid[])
  INTO v_agency_ids
  FROM trip_agencies
  WHERE trip_id = p_trip_id;

  IF p_source = 'auto' THEN
    v_event_type := 'trip.auto_completed';
    v_dedup_key := 'trip.auto_completed:' || p_trip_id::text
      || ':' || to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    v_payload := jsonb_build_object(
      'trip_id', p_trip_id,
      'route_id', v_trip.route_id,
      'departure_time', v_trip.departure_time,
      'status', 'completed',
      'source', 'auto',
      'agency_ids', to_jsonb(v_agency_ids)
    );
  ELSE
    v_event_type := 'trip.completed';
    v_dedup_key := 'trip.completed:' || p_trip_id::text;
    v_payload := jsonb_build_object(
      'trip_id', p_trip_id,
      'route_id', v_trip.route_id,
      'departure_time', v_trip.departure_time,
      'status', 'completed',
      'agency_ids', to_jsonb(v_agency_ids)
    );
  END IF;

  PERFORM public.emit_trip_event(v_event_type, p_trip_id, v_payload, v_dedup_key);

  RETURN jsonb_build_object('trip_id', p_trip_id, 'status', 'completed', 'source', p_source);
END;
$$;

COMMENT ON FUNCTION public.complete_trip(UUID, TEXT) IS
  'WKR-007 Fase 2: atomic trip completion (manual/auto) + trip.completed.v1 | trip.auto_completed.v1. SECURITY DEFINER; EXECUTE service_role only.';

-- ── 5) archive_trip ────────────────────────────────────────────
-- Replaces superadmin.service.ts archiveTrip (superadmin.service.ts:1289).

CREATE OR REPLACE FUNCTION public.archive_trip(
  p_trip_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_agency_ids UUID[];
BEGIN
  SELECT * INTO v_trip FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;

  IF v_trip.status = 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_ACTIVE: No se puede archivar un viaje activo. Cancela o completa el viaje primero.';
  END IF;

  IF v_trip.status = 'archived' THEN
    RAISE EXCEPTION 'ERR_ALREADY_ARCHIVED: El viaje ya está archivado.';
  END IF;

  IF v_trip.status NOT IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'ERR_TRIP_STATUS_INVALID: Solo se pueden archivar viajes cancelados o completados.';
  END IF;

  UPDATE trips SET status = 'archived' WHERE id = p_trip_id;

  SELECT COALESCE(array_agg(agency_id ORDER BY agency_id), '{}'::uuid[])
  INTO v_agency_ids
  FROM trip_agencies
  WHERE trip_id = p_trip_id;

  PERFORM public.emit_trip_event(
    'trip.archived',
    p_trip_id,
    jsonb_build_object(
      'trip_id', p_trip_id,
      'route_id', v_trip.route_id,
      'departure_time', v_trip.departure_time,
      'status', 'archived',
      'agency_ids', to_jsonb(v_agency_ids)
    ),
    'trip.archived:' || p_trip_id::text
  );

  RETURN jsonb_build_object('trip_id', p_trip_id, 'status', 'archived');
END;
$$;

COMMENT ON FUNCTION public.archive_trip(UUID) IS
  'WKR-007 Fase 2: atomic trip archive + trip.archived.v1. SECURITY DEFINER; EXECUTE service_role only.';

-- ── 6) Grants (posture 037/047) ────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.emit_trip_event(TEXT, UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.emit_trip_event(TEXT, UUID, JSONB, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.emit_trip_event(TEXT, UUID, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.emit_trip_event(TEXT, UUID, JSONB, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN) TO service_role;

REVOKE EXECUTE ON FUNCTION public.set_trip_status(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_trip_status(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_trip_status(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_trip_status(UUID, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_trip(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_trip(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_trip(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_trip(UUID, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.archive_trip(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_trip(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.archive_trip(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.archive_trip(UUID) TO service_role;
