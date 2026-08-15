-- ============================================================
-- 065_audit_log.sql
-- F5-001 — Audit Trail foundation
--
-- Append-only public.audit_log + audit_append writer.
-- Trip / reservation / boarding / branding / notification-pref hooks.
-- Client INSERT policies on reservations / boarding_logs removed
-- (writes via service_role SECURITY DEFINER RPCs only).
-- ============================================================

-- ── 1) audit_log table ─────────────────────────────────────────

CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  agency_id UUID NULL REFERENCES public.agencies(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NULL,
  before JSONB NULL,
  after JSONB NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT audit_log_actor_check CHECK (
    (actor_user_id IS NULL AND actor_role = 'system')
    OR (
      actor_user_id IS NOT NULL
      AND actor_role IN ('superadmin', 'agency')
    )
  ),
  CONSTRAINT audit_log_action_check CHECK (
    action IN (
      'trip.created',
      'trip.updated',
      'trip.cancelled',
      'reservation.created',
      'reservation.cancelled',
      'boarding.board',
      'boarding.unboard',
      'agency_settings.updated',
      'notification_preferences.updated'
    )
  ),
  CONSTRAINT audit_log_entity_type_check CHECK (
    entity_type IN (
      'trip',
      'reservation',
      'reservation_passenger',
      'agency_settings',
      'notification_preferences'
    )
  )
);

COMMENT ON TABLE public.audit_log IS
  'F5-001: append-only audit trail for admin/agency operational actions.';

COMMENT ON COLUMN public.audit_log.actor_role IS
  'F5-001: system | superadmin | agency. system requires actor_user_id NULL.';

COMMENT ON COLUMN public.audit_log.metadata IS
  'F5-001: free-form correlation (source, seat_code, freed_seat_count, etc.).';

CREATE INDEX idx_audit_log_entity_occurred
  ON public.audit_log (entity_type, entity_id, occurred_at DESC);

CREATE INDEX idx_audit_log_agency_occurred
  ON public.audit_log (agency_id, occurred_at DESC);

CREATE INDEX idx_audit_log_actor_occurred
  ON public.audit_log (actor_user_id, occurred_at DESC);

CREATE INDEX idx_audit_log_action_occurred
  ON public.audit_log (action, occurred_at DESC);

-- ── 2) RLS ─────────────────────────────────────────────────────

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.audit_log FROM PUBLIC;
REVOKE ALL ON TABLE public.audit_log FROM anon;
REVOKE ALL ON TABLE public.audit_log FROM authenticated;

-- Authenticated SELECT so RLS policies can apply (pattern: 062).
GRANT SELECT ON TABLE public.audit_log TO authenticated;
-- Writes only via DEFINER / service_role (pattern: trip_occupancy_alert_state).
GRANT SELECT, INSERT ON TABLE public.audit_log TO service_role;

DROP POLICY IF EXISTS audit_log_superadmin_select ON public.audit_log;
CREATE POLICY audit_log_superadmin_select
  ON public.audit_log
  FOR SELECT
  USING ((SELECT private.auth_app_role()) = 'superadmin');

DROP POLICY IF EXISTS audit_log_agency_select ON public.audit_log;
CREATE POLICY audit_log_agency_select
  ON public.audit_log
  FOR SELECT
  USING (
    (SELECT private.auth_app_role()) = 'agency'
    AND agency_id IS NOT NULL
    AND agency_id = (SELECT private.auth_app_agency_id())
  );

-- ── 3) Append-only guard ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_audit_log_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ERR_AUDIT_APPEND_ONLY: audit_log rows cannot be updated or deleted (F5-001)';
END;
$$;

COMMENT ON FUNCTION public.trg_audit_log_append_only() IS
  'F5-001: reject UPDATE/DELETE on audit_log.';

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON public.audit_log;
CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_audit_log_append_only();

-- ── 4) audit_append writer ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_append(
  p_actor_user_id UUID,
  p_actor_role TEXT,
  p_agency_id UUID,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_before JSONB,
  p_after JSONB,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT (
    (p_actor_user_id IS NULL AND p_actor_role = 'system')
    OR (
      p_actor_user_id IS NOT NULL
      AND p_actor_role IN ('superadmin', 'agency')
    )
  ) THEN
    RAISE EXCEPTION 'ERR_AUDIT_ACTOR: invalid actor_user_id/actor_role combination (F5-001)';
  END IF;

  INSERT INTO public.audit_log (
    actor_user_id,
    actor_role,
    agency_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    metadata
  ) VALUES (
    p_actor_user_id,
    p_actor_role,
    p_agency_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_before,
    p_after,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.audit_append(UUID, TEXT, UUID, TEXT, TEXT, UUID, JSONB, JSONB, JSONB) IS
  'F5-001: single writer for audit_log. SECURITY DEFINER; EXECUTE service_role only.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.audit_append(UUID, TEXT, UUID, TEXT, TEXT, UUID, JSONB, JSONB, JSONB) OWNER TO postgres;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.audit_append(UUID, TEXT, UUID, TEXT, TEXT, UUID, JSONB, JSONB, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_append(UUID, TEXT, UUID, TEXT, TEXT, UUID, JSONB, JSONB, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.audit_append(UUID, TEXT, UUID, TEXT, TEXT, UUID, JSONB, JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.audit_append(UUID, TEXT, UUID, TEXT, TEXT, UUID, JSONB, JSONB, JSONB) TO service_role;

-- ── 5) trips.updated_by ────────────────────────────────────────

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS updated_by UUID NULL
    REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.trips.updated_by IS
  'F5-001: last human actor for trip mutations (update/cancel); feeds audit trigger.';

-- ── 6) Trip audit trigger ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_trips_audit_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id UUID;
  v_actor_role TEXT;
  v_before JSONB := '{}'::jsonb;
  v_after JSONB := '{}'::jsonb;
  v_has_whitelist_change BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT u.role INTO v_actor_role
    FROM public.users u
    WHERE u.id = NEW.created_by;

    IF v_actor_role IS NULL OR v_actor_role NOT IN ('superadmin', 'agency') THEN
      RETURN NEW;
    END IF;

    PERFORM public.audit_append(
      NEW.created_by,
      v_actor_role,
      NULL,
      'trip.created',
      'trip',
      NEW.id,
      NULL,
      jsonb_build_object(
        'route_id', NEW.route_id,
        'departure_time', NEW.departure_time,
        'vehicle_type', NEW.vehicle_type,
        'capacity', NEW.capacity
      ),
      jsonb_build_object('source', 'api')
    );
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.status = 'active' AND NEW.status = 'cancelled' THEN
    v_actor_user_id := NEW.updated_by;
    IF v_actor_user_id IS NULL THEN
      v_actor_role := 'system';
    ELSE
      SELECT u.role INTO v_actor_role
      FROM public.users u
      WHERE u.id = v_actor_user_id;

      IF v_actor_role IS NULL OR v_actor_role NOT IN ('superadmin', 'agency') THEN
        v_actor_user_id := NULL;
        v_actor_role := 'system';
      END IF;
    END IF;

    PERFORM public.audit_append(
      v_actor_user_id,
      v_actor_role,
      NULL,
      'trip.cancelled',
      'trip',
      NEW.id,
      jsonb_build_object('status', 'active'),
      jsonb_build_object('status', 'cancelled'),
      jsonb_build_object('source', 'api')
    );
    RETURN NEW;
  END IF;

  -- Whitelist field diffs (never emit trip.updated on cancel path above)
  IF OLD.route_id IS DISTINCT FROM NEW.route_id THEN
    v_has_whitelist_change := TRUE;
    v_before := v_before || jsonb_build_object('route_id', OLD.route_id);
    v_after := v_after || jsonb_build_object('route_id', NEW.route_id);
  END IF;
  IF OLD.departure_time IS DISTINCT FROM NEW.departure_time THEN
    v_has_whitelist_change := TRUE;
    v_before := v_before || jsonb_build_object('departure_time', OLD.departure_time);
    v_after := v_after || jsonb_build_object('departure_time', NEW.departure_time);
  END IF;
  IF OLD.capacity IS DISTINCT FROM NEW.capacity THEN
    v_has_whitelist_change := TRUE;
    v_before := v_before || jsonb_build_object('capacity', OLD.capacity);
    v_after := v_after || jsonb_build_object('capacity', NEW.capacity);
  END IF;
  IF OLD.vehicle_type IS DISTINCT FROM NEW.vehicle_type THEN
    v_has_whitelist_change := TRUE;
    v_before := v_before || jsonb_build_object('vehicle_type', OLD.vehicle_type);
    v_after := v_after || jsonb_build_object('vehicle_type', NEW.vehicle_type);
  END IF;

  IF NOT v_has_whitelist_change THEN
    -- Ignore updates that only touch updated_at / postponed_from / created_by / updated_by / status (non-cancel)
    RETURN NEW;
  END IF;

  v_actor_user_id := NEW.updated_by;
  IF v_actor_user_id IS NULL THEN
    v_actor_role := 'system';
  ELSE
    SELECT u.role INTO v_actor_role
    FROM public.users u
    WHERE u.id = v_actor_user_id;

    IF v_actor_role IS NULL OR v_actor_role NOT IN ('superadmin', 'agency') THEN
      v_actor_user_id := NULL;
      v_actor_role := 'system';
    END IF;
  END IF;

  PERFORM public.audit_append(
    v_actor_user_id,
    v_actor_role,
    NULL,
    'trip.updated',
    'trip',
    NEW.id,
    v_before,
    v_after,
    jsonb_build_object('source', 'api')
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_trips_audit_fn() IS
  'F5-001: AFTER INSERT/UPDATE trips → trip.created | trip.updated | trip.cancelled.';

DROP TRIGGER IF EXISTS trg_trips_audit ON public.trips;
CREATE TRIGGER trg_trips_audit
  AFTER INSERT OR UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_trips_audit_fn();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.trg_trips_audit_fn() OWNER TO postgres;
  END IF;
END $$;

-- ── 7) Reservation created (deferred) ──────────────────────────

CREATE OR REPLACE FUNCTION public.trg_reservations_audit_created_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id UUID;
  v_actor_role TEXT;
  v_passenger_count INTEGER;
  v_seat_codes TEXT[];
BEGIN
  v_actor_user_id := NEW.created_by;

  IF v_actor_user_id IS NULL THEN
    v_actor_role := 'system';
  ELSE
    SELECT u.role INTO v_actor_role
    FROM public.users u
    WHERE u.id = v_actor_user_id;

    IF v_actor_role IS NULL OR v_actor_role NOT IN ('superadmin', 'agency') THEN
      v_actor_user_id := NULL;
      v_actor_role := 'system';
    END IF;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_passenger_count
  FROM public.reservation_passengers rp
  WHERE rp.reservation_id = NEW.id
    AND rp.status = 'active';

  SELECT COALESCE(array_agg(s.seat_code ORDER BY s.seat_code), ARRAY[]::TEXT[])
  INTO v_seat_codes
  FROM public.reservation_passengers rp
  JOIN public.seats s ON s.id = rp.seat_id
  WHERE rp.reservation_id = NEW.id
    AND rp.status = 'active';

  PERFORM public.audit_append(
    v_actor_user_id,
    v_actor_role,
    NEW.agency_id,
    'reservation.created',
    'reservation',
    NEW.id,
    NULL,
    jsonb_build_object(
      'trip_id', NEW.trip_id,
      'passenger_count', COALESCE(v_passenger_count, 0),
      'seat_codes', to_jsonb(COALESCE(v_seat_codes, ARRAY[]::TEXT[]))
    ),
    jsonb_build_object('source', 'api')
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_reservations_audit_created_fn() IS
  'F5-001: deferred AFTER INSERT reservations → reservation.created (passengers/seats visible at commit).';

DROP TRIGGER IF EXISTS trg_reservations_audit_created ON public.reservations;
DROP TRIGGER IF EXISTS trg_reservations_audit ON public.reservations;
CREATE CONSTRAINT TRIGGER trg_reservations_audit
  AFTER INSERT ON public.reservations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reservations_audit_created_fn();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.trg_reservations_audit_created_fn() OWNER TO postgres;
  END IF;
END $$;

-- ── 8) create_trip (unchanged behavior; trigger audits) ────────

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
  'WKR-007 + F5-001: atomic trip create + seats + trip_agencies + trip.created.v1; audit via trg_trips_audit. SECURITY DEFINER; EXECUTE service_role only.';

-- ── 9) update_trip (+ p_actor_user_id, fold postponed_from) ────

DROP FUNCTION IF EXISTS public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN);

CREATE OR REPLACE FUNCTION public.update_trip(
  p_trip_id UUID,
  p_route_id UUID,
  p_departure_time TIMESTAMPTZ,
  p_vehicle_type TEXT,
  p_agency_ids UUID[],
  p_postpone BOOLEAN DEFAULT FALSE,
  p_actor_user_id UUID DEFAULT NULL
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
        vehicle_type = p_vehicle_type,
        postponed_from = CASE
          WHEN v_real_postpone THEN v_old_departure
          ELSE postponed_from
        END,
        updated_by = p_actor_user_id
    WHERE id = p_trip_id
    RETURNING * INTO v_trip;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_TRIP_DUPLICATE: Ya existe un viaje programado para esta ruta en la fecha y hora seleccionadas.';
  END;

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

  IF v_real_postpone THEN
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

COMMENT ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN, UUID) IS
  'WKR-007 + F5-001: trip edit + seats/agencies + outbox; sets updated_by for audit. p_actor_user_id DEFAULT NULL keeps 6-arg calls valid.';

-- ── 10) set_trip_status (+ p_actor_user_id) ─────────────────────

DROP FUNCTION IF EXISTS public.set_trip_status(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.set_trip_status(
  p_trip_id UUID,
  p_status TEXT,
  p_actor_user_id UUID DEFAULT NULL
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

  UPDATE trips
  SET status = p_status,
      updated_by = p_actor_user_id
  WHERE id = p_trip_id;

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

COMMENT ON FUNCTION public.set_trip_status(UUID, TEXT, UUID) IS
  'WKR-007 + F5-001: trip cancelled/completed + seat release + outbox; sets updated_by for audit. p_actor_user_id DEFAULT NULL keeps 2-arg calls valid.';

-- ── 11) cancel_agency_reservation ──────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_agency_reservation(
  p_reservation_id UUID,
  p_actor_user_id UUID,
  p_agency_id UUID,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_reservation public.reservations%ROWTYPE;
  v_trip public.trips%ROWTYPE;
  v_seat_ids UUID[];
  v_freed_count INTEGER;
  v_audit_id UUID;
  v_meta JSONB;
BEGIN
  IF p_reservation_id IS NULL OR p_actor_user_id IS NULL OR p_agency_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CANCEL_PARAMS: reservation_id, actor_user_id and agency_id are required';
  END IF;

  SELECT * INTO v_actor
  FROM public.users
  WHERE id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ACTOR_NOT_FOUND: Actor not found';
  END IF;

  IF v_actor.role <> 'agency' OR v_actor.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_ACTOR_AGENCY_MISMATCH: Actor must be agency belonging to p_agency_id';
  END IF;

  SELECT * INTO v_reservation
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_RESERVATION_NOT_FOUND: Reservation not found';
  END IF;

  IF v_reservation.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_RESERVATION_NOT_OWNED: Reservation does not belong to agency';
  END IF;

  IF v_reservation.status <> 'confirmed' THEN
    RAISE EXCEPTION 'ERR_RESERVATION_NOT_CONFIRMED: Only confirmed reservations can be cancelled';
  END IF;

  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = v_reservation.trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;

  IF v_trip.status = 'cancelled' THEN
    RAISE EXCEPTION 'ERR_TRIP_CANCELLED: Este viaje fue cancelado. No es posible cancelar reservas.';
  END IF;

  IF v_trip.status = 'completed' THEN
    RAISE EXCEPTION 'ERR_TRIP_COMPLETED: Este viaje ya fue completado. No es posible cancelar reservas.';
  END IF;

  SELECT COALESCE(array_agg(rp.seat_id), ARRAY[]::UUID[])
  INTO v_seat_ids
  FROM public.reservation_passengers rp
  WHERE rp.reservation_id = p_reservation_id;

  UPDATE public.reservations
  SET status = 'cancelled'
  WHERE id = p_reservation_id;

  v_freed_count := COALESCE(cardinality(v_seat_ids), 0);

  IF v_freed_count > 0 THEN
    UPDATE public.seats
    SET status = 'available',
        updated_at = NOW()
    WHERE trip_id = v_reservation.trip_id
      AND id = ANY(v_seat_ids);
  END IF;

  v_meta := COALESCE(p_metadata, '{}'::jsonb)
    || jsonb_build_object('freed_seat_count', v_freed_count, 'source', 'api');

  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    p_agency_id,
    'reservation.cancelled',
    'reservation',
    p_reservation_id,
    jsonb_build_object('status', 'confirmed'),
    jsonb_build_object('status', 'cancelled'),
    v_meta
  );

  RETURN jsonb_build_object(
    'cancelled', true,
    'reservation_id', p_reservation_id,
    'freed_seats', v_freed_count,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.cancel_agency_reservation(UUID, UUID, UUID, JSONB) IS
  'F5-001: atomic agency reservation cancel + seat free + reservation.cancelled audit. SECURITY DEFINER; EXECUTE service_role only.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.cancel_agency_reservation(UUID, UUID, UUID, JSONB) OWNER TO postgres;
  END IF;
END $$;

-- ── 12) boarding_toggle (+ audit_append) ───────────────────────

CREATE OR REPLACE FUNCTION public.boarding_toggle(
  p_passenger_id UUID,
  p_boarded BOOLEAN,
  p_actor_user_id UUID,
  p_operator_agency_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation_id UUID;
  v_reservation public.reservations%ROWTYPE;
  v_passenger public.reservation_passengers%ROWTYPE;
  v_trip public.trips%ROWTYPE;
  v_actor_agency_id UUID;
  v_actor_role TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_boarded_at TIMESTAMPTZ;
  v_changed BOOLEAN := FALSE;
  v_new_status TEXT;
  v_boarded_count INTEGER;
  v_total_count INTEGER;
  v_state_before TEXT;
  v_state_after TEXT;
  v_seat_code TEXT;
BEGIN
  IF p_passenger_id IS NULL
     OR p_boarded IS NULL
     OR p_actor_user_id IS NULL
     OR p_operator_agency_id IS NULL THEN
    RAISE EXCEPTION 'Parámetros de boarding incompletos';
  END IF;

  SELECT rp.reservation_id
  INTO v_reservation_id
  FROM public.reservation_passengers rp
  WHERE rp.id = p_passenger_id;

  IF v_reservation_id IS NULL THEN
    RAISE EXCEPTION 'Pasajero no encontrado';
  END IF;

  SELECT r.*
  INTO v_reservation
  FROM public.reservations r
  WHERE r.id = v_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada';
  END IF;

  SELECT rp.*
  INTO v_passenger
  FROM public.reservation_passengers rp
  WHERE rp.id = p_passenger_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pasajero no encontrado';
  END IF;

  SELECT u.agency_id, u.role
  INTO v_actor_agency_id, v_actor_role
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actor no encontrado';
  END IF;

  IF v_actor_role IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION 'El actor debe tener rol agency';
  END IF;

  IF v_actor_agency_id IS DISTINCT FROM p_operator_agency_id THEN
    RAISE EXCEPTION 'El actor no pertenece a la agencia operadora';
  END IF;

  SELECT t.*
  INTO v_trip
  FROM public.trips t
  WHERE t.id = v_reservation.trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viaje no encontrado';
  END IF;

  IF v_trip.status = 'cancelled' THEN
    RAISE EXCEPTION 'Este viaje fue cancelado. No es posible realizar boarding.';
  END IF;

  IF v_trip.status = 'completed' THEN
    RAISE EXCEPTION 'Este viaje ya fue completado. No es posible realizar boarding.';
  END IF;

  IF v_trip.status = 'archived' THEN
    RAISE EXCEPTION 'Este viaje fue archivado. No es posible realizar boarding.';
  END IF;

  IF v_trip.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Este viaje no permite boarding.';
  END IF;

  IF v_trip.departure_time > v_now THEN
    RAISE EXCEPTION 'Este viaje aún no ha salido. No es posible realizar boarding.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.trip_agencies ta
    WHERE ta.trip_id = v_trip.id
      AND ta.agency_id = p_operator_agency_id
  ) THEN
    RAISE EXCEPTION 'Tu agencia no está asignada a este viaje';
  END IF;

  IF v_reservation.status = 'cancelled' THEN
    RAISE EXCEPTION 'La reserva fue cancelada';
  END IF;

  IF v_passenger.status = 'cancelled' THEN
    RAISE EXCEPTION 'No se puede abordar un pasajero cancelado';
  END IF;

  v_state_before := CASE WHEN v_passenger.boarded THEN 'boarded' ELSE 'unboarded' END;
  v_state_after := CASE WHEN p_boarded THEN 'boarded' ELSE 'unboarded' END;

  SELECT
    COUNT(*) FILTER (WHERE rp.boarded)::INTEGER,
    COUNT(*)::INTEGER
  INTO v_boarded_count, v_total_count
  FROM public.reservation_passengers rp
  WHERE rp.reservation_id = v_reservation.id
    AND rp.status = 'active';

  IF v_passenger.boarded IS NOT DISTINCT FROM p_boarded THEN
    RETURN jsonb_build_object(
      'passenger_id', v_passenger.id,
      'boarded', v_passenger.boarded,
      'boarded_at', v_passenger.boarded_at,
      'changed', false,
      'reservation_status', v_reservation.status,
      'boarded_count', v_boarded_count,
      'total_count', v_total_count
    );
  END IF;

  v_changed := TRUE;
  v_boarded_at := CASE WHEN p_boarded THEN v_now ELSE NULL END;

  UPDATE public.reservation_passengers
  SET
    boarded = p_boarded,
    boarded_at = v_boarded_at
  WHERE id = v_passenger.id;

  SELECT
    COUNT(*) FILTER (WHERE rp.boarded)::INTEGER,
    COUNT(*)::INTEGER
  INTO v_boarded_count, v_total_count
  FROM public.reservation_passengers rp
  WHERE rp.reservation_id = v_reservation.id
    AND rp.status = 'active';

  IF v_total_count > 0 AND v_boarded_count >= v_total_count THEN
    v_new_status := 'completed';
  ELSIF v_boarded_count > 0 THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'confirmed';
  END IF;

  UPDATE public.reservations
  SET status = v_new_status
  WHERE id = v_reservation.id;

  INSERT INTO public.boarding_logs (
    reservation_id,
    scanned_by,
    scanned_by_agency_id,
    reservation_passenger_id,
    action,
    seat_ids,
    trip_id,
    reservation_agency_id,
    state_before,
    state_after
  ) VALUES (
    v_reservation.id,
    p_actor_user_id,
    p_operator_agency_id,
    v_passenger.id,
    CASE WHEN p_boarded THEN 'board' ELSE 'unboard' END,
    jsonb_build_array(v_passenger.seat_id),
    v_trip.id,
    v_reservation.agency_id,
    v_state_before,
    v_state_after
  );

  SELECT s.seat_code INTO v_seat_code
  FROM public.seats s
  WHERE s.id = v_passenger.seat_id;

  PERFORM public.audit_append(
    p_actor_user_id,
    v_actor_role,
    p_operator_agency_id,
    CASE WHEN p_boarded THEN 'boarding.board' ELSE 'boarding.unboard' END,
    'reservation_passenger',
    v_passenger.id,
    NULL,
    NULL,
    jsonb_build_object(
      'seat_code', v_seat_code,
      'source', 'api'
    )
  );

  RETURN jsonb_build_object(
    'passenger_id', v_passenger.id,
    'boarded', p_boarded,
    'boarded_at', v_boarded_at,
    'changed', v_changed,
    'reservation_status', v_new_status,
    'boarded_count', v_boarded_count,
    'total_count', v_total_count
  );
END;
$$;

COMMENT ON FUNCTION public.boarding_toggle(UUID, BOOLEAN, UUID, UUID) IS
  'AUD-020 + F5-001: transactional boarding transition + boarding.board/unboard audit. SECURITY DEFINER; EXECUTE service_role only.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.boarding_toggle(UUID, BOOLEAN, UUID, UUID) OWNER TO postgres;
  END IF;
END $$;

-- ── 13) update_agency_branding ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_agency_branding(
  p_agency_id UUID,
  p_actor_user_id UUID,
  p_patch JSONB,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_row public.agency_settings%ROWTYPE;
  v_before JSONB := '{}'::jsonb;
  v_after JSONB := '{}'::jsonb;
  v_key TEXT;
  v_allowed TEXT[] := ARRAY['logo_url', 'primary_color', 'secondary_color', 'accent_color'];
  v_new_logo TEXT;
  v_new_primary TEXT;
  v_new_secondary TEXT;
  v_new_accent TEXT;
  v_audit_id UUID;
BEGIN
  IF p_agency_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_BRANDING_PARAMS: agency_id and actor_user_id are required';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'ERR_BRANDING_PATCH: p_patch must be a JSON object';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch)
  LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'ERR_BRANDING_KEY: unknown branding key %', v_key;
    END IF;
  END LOOP;

  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ACTOR_NOT_FOUND: Actor not found';
  END IF;

  IF v_actor.role <> 'agency' OR v_actor.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_ACTOR_AGENCY_MISMATCH: Actor must be agency belonging to p_agency_id';
  END IF;

  SELECT * INTO v_row
  FROM public.agency_settings
  WHERE agency_id = p_agency_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SETTINGS_NOT_FOUND: Configuración de marca no encontrada';
  END IF;

  v_new_logo := v_row.logo_url;
  v_new_primary := v_row.primary_color;
  v_new_secondary := v_row.secondary_color;
  v_new_accent := v_row.accent_color;

  IF p_patch ? 'logo_url' THEN
    IF jsonb_typeof(p_patch->'logo_url') = 'null' THEN
      v_new_logo := NULL;
    ELSE
      v_new_logo := p_patch->>'logo_url';
    END IF;
  END IF;
  IF p_patch ? 'primary_color' THEN
    v_new_primary := p_patch->>'primary_color';
  END IF;
  IF p_patch ? 'secondary_color' THEN
    v_new_secondary := p_patch->>'secondary_color';
  END IF;
  IF p_patch ? 'accent_color' THEN
    v_new_accent := p_patch->>'accent_color';
  END IF;

  IF v_row.logo_url IS DISTINCT FROM v_new_logo THEN
    v_before := v_before || jsonb_build_object('logo_url', v_row.logo_url);
    v_after := v_after || jsonb_build_object('logo_url', v_new_logo);
  END IF;
  IF v_row.primary_color IS DISTINCT FROM v_new_primary THEN
    v_before := v_before || jsonb_build_object('primary_color', v_row.primary_color);
    v_after := v_after || jsonb_build_object('primary_color', v_new_primary);
  END IF;
  IF v_row.secondary_color IS DISTINCT FROM v_new_secondary THEN
    v_before := v_before || jsonb_build_object('secondary_color', v_row.secondary_color);
    v_after := v_after || jsonb_build_object('secondary_color', v_new_secondary);
  END IF;
  IF v_row.accent_color IS DISTINCT FROM v_new_accent THEN
    v_before := v_before || jsonb_build_object('accent_color', v_row.accent_color);
    v_after := v_after || jsonb_build_object('accent_color', v_new_accent);
  END IF;

  IF v_before = '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'agency_id', p_agency_id,
      'logo_url', v_row.logo_url,
      'primary_color', v_row.primary_color,
      'secondary_color', v_row.secondary_color,
      'accent_color', v_row.accent_color,
      'changed', false
    );
  END IF;

  UPDATE public.agency_settings
  SET logo_url = v_new_logo,
      primary_color = v_new_primary,
      secondary_color = v_new_secondary,
      accent_color = v_new_accent
  WHERE agency_id = p_agency_id
  RETURNING * INTO v_row;

  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    p_agency_id,
    'agency_settings.updated',
    'agency_settings',
    p_agency_id,
    v_before,
    v_after,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source', 'api')
  );

  RETURN jsonb_build_object(
    'agency_id', p_agency_id,
    'logo_url', v_row.logo_url,
    'primary_color', v_row.primary_color,
    'secondary_color', v_row.secondary_color,
    'accent_color', v_row.accent_color,
    'changed', true,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.update_agency_branding(UUID, UUID, JSONB, JSONB) IS
  'F5-001: patch agency_settings branding + agency_settings.updated audit. SECURITY DEFINER; EXECUTE service_role only.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.update_agency_branding(UUID, UUID, JSONB, JSONB) OWNER TO postgres;
  END IF;
END $$;

-- ── 14) update_agency_notification_preferences ─────────────────

CREATE OR REPLACE FUNCTION public.update_agency_notification_preferences(
  p_agency_id UUID,
  p_actor_user_id UUID,
  p_patch JSONB,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_category TEXT;
  v_enabled BOOLEAN;
  v_allowed TEXT[] := ARRAY[
    'trip_assignments',
    'trip_schedule_changes',
    'trip_status_updates',
    'trip_cancellations',
    'trip_reminders',
    'ops_digest',
    'occupancy_alerts'
  ];
  v_old_in_app BOOLEAN;
  v_old_email BOOLEAN;
  v_before JSONB := '{}'::jsonb;
  v_after JSONB := '{}'::jsonb;
  v_audit_id UUID;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_agency_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PREF_PARAMS: agency_id and actor_user_id are required';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'ERR_PREF_PATCH: p_patch must be a JSON object of {category: boolean}';
  END IF;

  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ACTOR_NOT_FOUND: Actor not found';
  END IF;

  IF v_actor.role <> 'agency' OR v_actor.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_ACTOR_AGENCY_MISMATCH: Actor must be agency belonging to p_agency_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agencies WHERE id = p_agency_id) THEN
    RAISE EXCEPTION 'ERR_AGENCY_NOT_FOUND: Agency not found';
  END IF;

  FOR v_category, v_enabled IN
    SELECT
      e.key,
      CASE
        WHEN jsonb_typeof(e.value) = 'boolean' THEN (e.value = 'true'::jsonb)
        ELSE NULL
      END
    FROM jsonb_each(p_patch) AS e
  LOOP
    IF NOT (v_category = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'ERR_PREF_CATEGORY: Unknown notification category: %', v_category;
    END IF;

    IF v_enabled IS NULL THEN
      RAISE EXCEPTION 'ERR_PREF_VALUE: category % must be a boolean', v_category;
    END IF;

    IF v_category = 'trip_cancellations' AND v_enabled IS FALSE THEN
      RAISE EXCEPTION 'ERR_PREF_LOCKED: trip_cancellations cannot be disabled';
    END IF;

    SELECT in_app_enabled, email_enabled
    INTO v_old_in_app, v_old_email
    FROM public.agency_notification_preferences
    WHERE agency_id = p_agency_id
      AND category = v_category
    FOR UPDATE;

    IF NOT FOUND THEN
      v_old_in_app := TRUE;
      v_old_email := TRUE;
    END IF;

    IF v_old_in_app IS DISTINCT FROM v_enabled
       OR v_old_email IS DISTINCT FROM v_enabled THEN
      v_before := v_before || jsonb_build_object(
        v_category,
        jsonb_build_object('in_app', v_old_in_app, 'email', v_old_email)
      );
      v_after := v_after || jsonb_build_object(
        v_category,
        jsonb_build_object('in_app', v_enabled, 'email', v_enabled)
      );

      INSERT INTO public.agency_notification_preferences (
        agency_id, category, in_app_enabled, email_enabled, updated_at
      ) VALUES (
        p_agency_id, v_category, v_enabled, v_enabled, v_now
      )
      ON CONFLICT (agency_id, category) DO UPDATE
      SET in_app_enabled = EXCLUDED.in_app_enabled,
          email_enabled = EXCLUDED.email_enabled,
          updated_at = EXCLUDED.updated_at;
    END IF;
  END LOOP;

  IF v_before <> '{}'::jsonb THEN
    v_audit_id := public.audit_append(
      p_actor_user_id,
      'agency',
      p_agency_id,
      'notification_preferences.updated',
      'notification_preferences',
      p_agency_id,
      v_before,
      v_after,
      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source', 'api')
    );
  END IF;

  RETURN jsonb_build_object(
    'agency_id', p_agency_id,
    'changed', (v_before <> '{}'::jsonb),
    'before', v_before,
    'after', v_after,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.update_agency_notification_preferences(UUID, UUID, JSONB, JSONB) IS
  'F5-001: upsert agency notification prefs from boolean patch + single audit row. SECURITY DEFINER; EXECUTE service_role only.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.update_agency_notification_preferences(UUID, UUID, JSONB, JSONB) OWNER TO postgres;
  END IF;
END $$;

-- ── 15) Harden client INSERT paths ─────────────────────────────

DROP POLICY IF EXISTS bl_agency_insert ON public.boarding_logs;
DROP POLICY IF EXISTS "bl_agency_insert" ON public.boarding_logs;
DROP POLICY IF EXISTS reservations_agency_insert ON public.reservations;
DROP POLICY IF EXISTS "reservations_agency_insert" ON public.reservations;

REVOKE INSERT ON TABLE public.reservations FROM authenticated;
REVOKE INSERT ON TABLE public.reservations FROM anon;
REVOKE INSERT ON TABLE public.boarding_logs FROM authenticated;
REVOKE INSERT ON TABLE public.boarding_logs FROM anon;

-- ── 16) EXECUTE grants (service_role only) ─────────────────────

REVOKE EXECUTE ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.set_trip_status(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_trip_status(UUID, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_trip_status(UUID, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_trip_status(UUID, TEXT, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cancel_agency_reservation(UUID, UUID, UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_agency_reservation(UUID, UUID, UUID, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_agency_reservation(UUID, UUID, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_agency_reservation(UUID, UUID, UUID, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.boarding_toggle(UUID, BOOLEAN, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.boarding_toggle(UUID, BOOLEAN, UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.boarding_toggle(UUID, BOOLEAN, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.boarding_toggle(UUID, BOOLEAN, UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_agency_branding(UUID, UUID, JSONB, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_agency_branding(UUID, UUID, JSONB, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_agency_branding(UUID, UUID, JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_agency_branding(UUID, UUID, JSONB, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_agency_notification_preferences(UUID, UUID, JSONB, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_agency_notification_preferences(UUID, UUID, JSONB, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_agency_notification_preferences(UUID, UUID, JSONB, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_agency_notification_preferences(UUID, UUID, JSONB, JSONB) TO service_role;
