-- ============================================================
-- 069_reservation_link_rpcs.sql
-- F5-004 — shared reservation core, link RPCs, public RPCs,
-- outbox helper, audit/notification CHECKs, seat-delete guard.
-- ============================================================

-- ── 0) CHECK extensions ──────────────────────────────────────

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check CHECK (
  action IN (
    'trip.created',
    'trip.updated',
    'trip.cancelled',
    'reservation.created',
    'reservation.cancelled',
    'boarding.board',
    'boarding.unboard',
    'agency_settings.updated',
    'notification_preferences.updated',
    'reservation_link.created',
    'reservation_link.cancelled',
    'reservation_link.confirmed',
    'reservation_link.regenerated',
    'reservation_link.passenger_data_saved',
    'reservation_link.expired'
  )
);

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_entity_type_check CHECK (
  entity_type IN (
    'trip',
    'reservation',
    'reservation_passenger',
    'agency_settings',
    'notification_preferences',
    'reservation_link'
  )
);

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'trip_created',
    'trip_cancelled',
    'trip_completed',
    'trip_auto_completed',
    'trip_postponed',
    'trip_archived',
    'trip_reminder',
    'reservation_created',
    'reservation_cancelled',
    'passenger_cancelled',
    'occupancy_alert',
    'reservation_link_passenger_data'
  ));

DO $$
DECLARE
  v_con TEXT;
BEGIN
  SELECT c.conname INTO v_con
  FROM pg_constraint c
  WHERE c.conrelid = 'public.notifications'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%entity_type%'
    AND c.conname <> 'notifications_type_check';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_entity_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type IN ('trip', 'reservation', 'passenger', 'reservation_link'));

-- ── 1) Helpers ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.emit_reservation_link_event(
  p_event_type TEXT,
  p_link_id UUID,
  p_agency_id UUID,
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
    'reservation_link',
    p_link_id,
    p_agency_id,
    p_payload,
    'pending',
    0,
    NOW(),
    p_dedup_key
  )
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.reservation_link_trip_snapshot(p_trip_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'status', t.status,
    'departure_time', t.departure_time,
    'route_id', t.route_id,
    'vehicle_type', t.vehicle_type,
    'capacity', t.capacity
  )
  FROM public.trips t
  WHERE t.id = p_trip_id;
$$;

CREATE OR REPLACE FUNCTION public.reservation_link_trip_diverged(
  p_trip_id UUID,
  p_snapshot JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trips t
    WHERE t.id = p_trip_id
      AND (
        t.status IS DISTINCT FROM (p_snapshot->>'status')
        OR t.departure_time IS DISTINCT FROM (p_snapshot->>'departure_time')::timestamptz
        OR t.route_id IS DISTINCT FROM (p_snapshot->>'route_id')::uuid
        OR t.vehicle_type IS DISTINCT FROM (p_snapshot->>'vehicle_type')
        OR t.capacity IS DISTINCT FROM (p_snapshot->>'capacity')::integer
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.reservation_link_agency_owns_lock(
  p_locked_by UUID,
  p_agency_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_locked_by AND u.agency_id = p_agency_id
  );
$$;

CREATE OR REPLACE FUNCTION public.reservation_link_apply_lazy(p_link_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.reservation_links;
BEGIN
  SELECT * INTO v_link
  FROM public.reservation_links
  WHERE id = p_link_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'LINK_NOT_FOUND';
  END IF;

  IF v_link.status = 'confirmed' THEN
    RETURN 'LINK_CONFIRMED';
  END IF;
  IF v_link.status = 'cancelled' THEN
    RETURN 'LINK_CANCELLED';
  END IF;
  IF v_link.status = 'expired' THEN
    RETURN 'LINK_EXPIRED';
  END IF;

  IF v_link.expires_at <= NOW() THEN
    UPDATE public.reservation_links SET status = 'expired' WHERE id = p_link_id;
    PERFORM public.audit_append(
      NULL, 'system', v_link.agency_id,
      'reservation_link.expired', 'reservation_link', p_link_id,
      NULL, jsonb_build_object('status', 'expired'), '{}'::jsonb
    );
    RETURN 'LINK_EXPIRED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.trips WHERE id = v_link.trip_id) THEN
    UPDATE public.reservation_links SET status = 'expired' WHERE id = p_link_id;
    PERFORM public.audit_append(
      NULL, 'system', v_link.agency_id,
      'reservation_link.expired', 'reservation_link', p_link_id,
      NULL, jsonb_build_object('status', 'expired', 'reason', 'trip_missing'), '{}'::jsonb
    );
    RETURN 'TRIP_MISSING';
  END IF;

  IF public.reservation_link_trip_diverged(v_link.trip_id, v_link.trip_snapshot) THEN
    UPDATE public.reservation_links SET status = 'expired' WHERE id = p_link_id;
    PERFORM public.audit_append(
      NULL, 'system', v_link.agency_id,
      'reservation_link.expired', 'reservation_link', p_link_id,
      NULL, jsonb_build_object('status', 'expired', 'reason', 'trip_changed'), '{}'::jsonb
    );
    RETURN 'TRIP_CHANGED';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.reservation_link_sanitize_link_data(
  p_link_data JSONB,
  p_authorized_codes TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_passengers JSONB := '[]'::jsonb;
  v_elem JSONB;
  v_code TEXT;
  v_seen TEXT[] := ARRAY[]::TEXT[];
  v_count INT := 0;
  v_auth_count INT;
BEGIN
  IF p_link_data IS NULL OR jsonb_typeof(p_link_data) <> 'object' THEN
    RAISE EXCEPTION 'ERR_SEAT_NOT_IN_LINK: Invalid link_data';
  END IF;

  v_auth_count := COALESCE(array_length(p_authorized_codes, 1), 0);
  IF jsonb_typeof(COALESCE(p_link_data->'passengers', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'ERR_SEAT_NOT_IN_LINK: passengers must be an array';
  END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(COALESCE(p_link_data->'passengers', '[]'::jsonb))
  LOOP
    v_code := NULLIF(btrim(COALESCE(v_elem->>'seat_code', '')), '');
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'ERR_SEAT_NOT_IN_LINK: passenger seat_code is required';
    END IF;
    IF NOT (v_code = ANY (p_authorized_codes)) THEN
      RAISE EXCEPTION 'ERR_SEAT_NOT_IN_LINK: Seat % is not in this link', v_code;
    END IF;
    IF v_code = ANY (v_seen) THEN
      RAISE EXCEPTION 'ERR_SEAT_NOT_IN_LINK: Duplicate seat_code %', v_code;
    END IF;
    v_seen := array_append(v_seen, v_code);
    v_count := v_count + 1;
    v_passengers := v_passengers || jsonb_build_array(jsonb_build_object(
      'seat_code', v_code,
      'name', COALESCE(v_elem->>'name', ''),
      'document', COALESCE(v_elem->>'document', ''),
      'phone', COALESCE(v_elem->>'phone', '')
    ));
  END LOOP;

  IF v_count <> v_auth_count THEN
    RAISE EXCEPTION 'ERR_SEAT_NOT_IN_LINK: Passenger count must match authorized seats';
  END IF;

  RETURN jsonb_build_object(
    'booker_name', COALESCE(p_link_data->>'booker_name', ''),
    'booker_document', COALESCE(p_link_data->>'booker_document', ''),
    'booker_phone', COALESCE(p_link_data->>'booker_phone', ''),
    'passengers', v_passengers
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reservation_link_public_body(p_link_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.reservation_links;
  v_destination TEXT;
  v_departure TIMESTAMPTZ;
  v_agency_name TEXT;
  v_logo TEXT;
  v_codes TEXT[];
BEGIN
  SELECT * INTO v_link FROM public.reservation_links WHERE id = p_link_id;
  SELECT r.destination, t.departure_time
    INTO v_destination, v_departure
  FROM public.trips t
  JOIN public.routes r ON r.id = t.route_id
  WHERE t.id = v_link.trip_id;

  SELECT a.name INTO v_agency_name FROM public.agencies a WHERE a.id = v_link.agency_id;
  SELECT s.logo_url INTO v_logo FROM public.agency_settings s WHERE s.agency_id = v_link.agency_id;

  SELECT COALESCE(array_agg(rls.seat_code ORDER BY rls.seat_code), ARRAY[]::TEXT[])
    INTO v_codes
  FROM public.reservation_link_seats rls
  WHERE rls.link_id = p_link_id;

  RETURN jsonb_build_object(
    'trip', jsonb_build_object(
      'destination', v_destination,
      'departure_time', v_departure
    ),
    'agency', jsonb_build_object(
      'name', v_agency_name,
      'logo_url', v_logo
    ),
    'seats', to_jsonb(v_codes),
    'link_data', COALESCE(v_link.link_data, '{}'::jsonb),
    'expires_at', v_link.expires_at
  );
END;
$$;

-- ── 2) Shared reservation core ────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_reservation_core(
  p_trip_id UUID,
  p_agency_id UUID,
  p_created_by UUID,
  p_booker_name TEXT,
  p_booker_document TEXT,
  p_booker_phone TEXT,
  p_seat_ids UUID[],
  p_passenger_names TEXT[],
  p_passenger_documents TEXT[],
  p_passenger_phones TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation_id UUID;
  v_ticket_code CHAR(8);
  v_qr_code TEXT;
  v_destination TEXT;
  v_i INTEGER;
BEGIN
  SELECT r.destination INTO v_destination
  FROM public.trips t
  JOIN public.routes r ON r.id = t.route_id
  WHERE t.id = p_trip_id;

  v_reservation_id := gen_random_uuid();
  v_ticket_code := UPPER(LEFT(REPLACE(v_reservation_id::text, '-', ''), 8));
  v_qr_code := 'NT-' || UPPER(COALESCE(v_destination, '')) || '-' || UPPER(REPLACE(v_reservation_id::TEXT, '-', ''));

  INSERT INTO public.reservations (
    id, trip_id, agency_id, created_by,
    booker_name, booker_document, booker_phone,
    qr_code, ticket_code, status
  ) VALUES (
    v_reservation_id, p_trip_id, p_agency_id, p_created_by,
    p_booker_name, p_booker_document, NULLIF(p_booker_phone, ''),
    v_qr_code, v_ticket_code, 'confirmed'
  );

  FOR v_i IN 1 .. array_length(p_seat_ids, 1) LOOP
    INSERT INTO public.reservation_passengers (reservation_id, seat_id, name, document, phone)
    VALUES (
      v_reservation_id,
      p_seat_ids[v_i],
      p_passenger_names[v_i],
      p_passenger_documents[v_i],
      NULLIF(p_passenger_phones[v_i], '')
    );
  END LOOP;

  UPDATE public.seats
  SET status = 'reserved',
      locked_by = NULL,
      locked_at = NULL,
      lock_expires_at = NULL,
      updated_at = NOW()
  WHERE trip_id = p_trip_id AND id = ANY(p_seat_ids);

  RETURN jsonb_build_object(
    'reservation_id', v_reservation_id,
    'qr_code', v_qr_code,
    'ticket_code', v_ticket_code
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_agency_reservation(
  p_trip_id UUID,
  p_agency_id UUID,
  p_created_by UUID,
  p_booker_name TEXT,
  p_booker_document TEXT,
  p_booker_phone TEXT,
  p_seat_ids UUID[],
  p_passenger_names TEXT[],
  p_passenger_documents TEXT[],
  p_passenger_phones TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seat RECORD;
  v_found_count INTEGER;
  v_trip_status TEXT;
  v_departure_time TIMESTAMPTZ;
BEGIN
  SELECT status, departure_time
    INTO v_trip_status, v_departure_time
  FROM public.trips
  WHERE id = p_trip_id;

  IF NOT FOUND OR v_trip_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found or not active';
  END IF;

  IF v_departure_time <= NOW() THEN
    RAISE EXCEPTION 'ERR_TRIP_DEPARTED: Cannot create a reservation after departure time';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.trip_agencies
    WHERE trip_id = p_trip_id AND agency_id = p_agency_id
  ) THEN
    RAISE EXCEPTION 'ERR_AGENCY_NOT_ASSIGNED: Your agency is not assigned to this trip';
  END IF;

  IF array_length(p_seat_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'ERR_NO_SEATS: At least one seat is required';
  END IF;

  IF array_length(p_passenger_names, 1) != array_length(p_seat_ids, 1)
    OR array_length(p_passenger_documents, 1) != array_length(p_seat_ids, 1)
    OR array_length(p_passenger_phones, 1) != array_length(p_seat_ids, 1)
  THEN
    RAISE EXCEPTION 'ERR_PASSENGER_MISMATCH: Passenger arrays must match seat count';
  END IF;

  v_found_count := 0;
  FOR v_seat IN
    SELECT id, seat_code, status, locked_by
    FROM public.seats
    WHERE trip_id = p_trip_id AND id = ANY(p_seat_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    v_found_count := v_found_count + 1;
    IF NOT (
      v_seat.status = 'available'
      OR (v_seat.status = 'locked' AND v_seat.locked_by = p_created_by)
    ) THEN
      RAISE EXCEPTION 'ERR_SEAT_UNAVAILABLE: Seat % is not available (status: %)',
        v_seat.seat_code, v_seat.status;
    END IF;
  END LOOP;

  IF v_found_count != array_length(p_seat_ids, 1) THEN
    RAISE EXCEPTION 'ERR_SEAT_NOT_FOUND: One or more seats not found in this trip';
  END IF;

  RETURN public.create_reservation_core(
    p_trip_id, p_agency_id, p_created_by,
    p_booker_name, p_booker_document, p_booker_phone,
    p_seat_ids, p_passenger_names, p_passenger_documents, p_passenger_phones
  );
END;
$$;

-- ── 3) create_reservation_link ────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_reservation_link(
  p_trip_id UUID,
  p_agency_id UUID,
  p_created_by UUID,
  p_token_hash TEXT,
  p_seat_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_status TEXT;
  v_departure TIMESTAMPTZ;
  v_seat RECORD;
  v_found_count INTEGER;
  v_link_id UUID;
  v_expires TIMESTAMPTZ;
  v_codes TEXT[];
  v_snapshot JSONB;
BEGIN
  SELECT status, departure_time INTO v_trip_status, v_departure
  FROM public.trips WHERE id = p_trip_id;

  IF NOT FOUND OR v_trip_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found or not active';
  END IF;
  IF v_departure <= NOW() THEN
    RAISE EXCEPTION 'ERR_TRIP_DEPARTED: Cannot create a reservation after departure time';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.trip_agencies
    WHERE trip_id = p_trip_id AND agency_id = p_agency_id
  ) THEN
    RAISE EXCEPTION 'ERR_AGENCY_NOT_ASSIGNED: Your agency is not assigned to this trip';
  END IF;
  IF array_length(p_seat_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'ERR_NO_SEATS: At least one seat is required';
  END IF;

  v_found_count := 0;
  FOR v_seat IN
    SELECT id, seat_code, status, locked_by, lock_expires_at
    FROM public.seats
    WHERE trip_id = p_trip_id AND id = ANY(p_seat_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    v_found_count := v_found_count + 1;
    IF NOT (
      v_seat.status = 'locked'
      AND v_seat.locked_by = p_created_by
      AND v_seat.lock_expires_at IS NOT NULL
      AND v_seat.lock_expires_at > NOW()
    ) THEN
      RAISE EXCEPTION 'ERR_SEAT_INVALID_LOCK: Seat % does not have a valid lock owned by the creator',
        v_seat.seat_code;
    END IF;
  END LOOP;

  IF v_found_count != array_length(p_seat_ids, 1) THEN
    RAISE EXCEPTION 'ERR_SEAT_NOT_FOUND: One or more seats not found in this trip';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reservation_link_seats rls
    JOIN public.reservation_links rl ON rl.id = rls.link_id
    WHERE rls.seat_id = ANY(p_seat_ids)
      AND rl.status = 'active'
  ) THEN
    RAISE EXCEPTION 'ERR_SEAT_ACTIVE_LINK: Seat already in an active link';
  END IF;

  UPDATE public.seats
  SET lock_expires_at = NOW() + INTERVAL '900 seconds'
  WHERE id = ANY(p_seat_ids)
    AND status = 'locked'
    AND locked_by = p_created_by
    AND lock_expires_at > NOW();

  v_snapshot := public.reservation_link_trip_snapshot(p_trip_id);
  v_link_id := gen_random_uuid();
  v_expires := NOW() + INTERVAL '900 seconds';

  INSERT INTO public.reservation_links (
    id, token_hash, trip_id, agency_id, created_by,
    status, expires_at, trip_snapshot
  ) VALUES (
    v_link_id, p_token_hash, p_trip_id, p_agency_id, p_created_by,
    'active', v_expires, v_snapshot
  );

  BEGIN
    INSERT INTO public.reservation_link_seats (link_id, seat_id, seat_code)
    SELECT v_link_id, s.id, s.seat_code
    FROM public.seats s
    WHERE s.id = ANY(p_seat_ids);
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'ERR_SEAT_ACTIVE_LINK: Seat already in an active link';
  END;

  SELECT COALESCE(array_agg(s.seat_code ORDER BY s.seat_code), ARRAY[]::TEXT[])
    INTO v_codes
  FROM public.seats s
  WHERE s.id = ANY(p_seat_ids);

  PERFORM public.emit_reservation_link_event(
    'reservation_link.created',
    v_link_id,
    p_agency_id,
    jsonb_build_object('link_id', v_link_id, 'trip_id', p_trip_id, 'agency_id', p_agency_id),
    'reservation_link.created:' || v_link_id::text
  );

  PERFORM public.audit_append(
    p_created_by, 'agency', p_agency_id,
    'reservation_link.created', 'reservation_link', v_link_id,
    NULL, jsonb_build_object('seat_codes', to_jsonb(v_codes), 'trip_id', p_trip_id),
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'link_id', v_link_id,
    'seat_codes', to_jsonb(v_codes),
    'expires_at', v_expires
  );
END;
$$;

-- ── 4) confirm_reservation_from_link ─────────────────────────

CREATE OR REPLACE FUNCTION public.confirm_reservation_from_link(
  p_link_id UUID,
  p_agency_id UUID,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.reservation_links;
  v_code TEXT;
  v_seat RECORD;
  v_pax JSONB;
  v_elem JSONB;
  v_seat_ids UUID[] := ARRAY[]::UUID[];
  v_names TEXT[] := ARRAY[]::TEXT[];
  v_docs TEXT[] := ARRAY[]::TEXT[];
  v_phones TEXT[] := ARRAY[]::TEXT[];
  v_booker_name TEXT;
  v_booker_document TEXT;
  v_booker_phone TEXT;
  v_result JSONB;
  v_departure TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_link
  FROM public.reservation_links
  WHERE id = p_link_id
  FOR UPDATE;

  IF NOT FOUND OR v_link.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_LINK_NOT_FOUND: Link not found';
  END IF;

  v_code := public.reservation_link_apply_lazy(p_link_id);
  IF v_code IS NOT NULL THEN
    IF v_code IN ('LINK_NOT_FOUND') THEN
      RAISE EXCEPTION 'ERR_LINK_NOT_FOUND: Link not found';
    ELSIF v_code = 'LINK_EXPIRED' THEN
      RAISE EXCEPTION 'ERR_LINK_EXPIRED: Link has expired';
    ELSIF v_code = 'LINK_CONFIRMED' THEN
      RAISE EXCEPTION 'ERR_LINK_CONFIRMED: Link already confirmed';
    ELSIF v_code = 'LINK_CANCELLED' THEN
      RAISE EXCEPTION 'ERR_LINK_CANCELLED: Link was cancelled';
    ELSIF v_code = 'TRIP_MISSING' THEN
      RAISE EXCEPTION 'ERR_TRIP_MISSING: Trip is no longer available';
    ELSIF v_code = 'TRIP_CHANGED' THEN
      RAISE EXCEPTION 'ERR_TRIP_CHANGED: Trip was modified';
    END IF;
  END IF;

  SELECT departure_time INTO v_departure FROM public.trips WHERE id = v_link.trip_id;
  IF v_departure <= NOW() THEN
    RAISE EXCEPTION 'ERR_TRIP_DEPARTED: Cannot create a reservation after departure time';
  END IF;

  SELECT * INTO v_link FROM public.reservation_links WHERE id = p_link_id;

  FOR v_seat IN
    SELECT rls.seat_id, rls.seat_code
    FROM public.reservation_link_seats rls
    WHERE rls.link_id = p_link_id
    ORDER BY rls.seat_code
  LOOP
    IF v_seat.seat_id IS NULL THEN
      RAISE EXCEPTION 'ERR_SEAT_INVALID_LOCK: Seat % no longer exists', v_seat.seat_code;
    END IF;
    v_pax := NULL;
    FOR v_elem IN SELECT value FROM jsonb_array_elements(COALESCE(v_link.link_data->'passengers', '[]'::jsonb))
    LOOP
      IF v_elem->>'seat_code' = v_seat.seat_code THEN
        v_pax := v_elem;
      END IF;
    END LOOP;
    IF v_pax IS NULL THEN
      RAISE EXCEPTION 'ERR_SEAT_NOT_IN_LINK: Missing passenger for seat %', v_seat.seat_code;
    END IF;
    IF NULLIF(btrim(COALESCE(v_pax->>'name', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_pax->>'document', '')), '') IS NULL THEN
      RAISE EXCEPTION 'ERR_PASSENGER_INCOMPLETE: Name and document required for seat %', v_seat.seat_code;
    END IF;
    v_seat_ids := array_append(v_seat_ids, v_seat.seat_id);
    v_names := array_append(v_names, btrim(v_pax->>'name'));
    v_docs := array_append(v_docs, btrim(v_pax->>'document'));
    v_phones := array_append(v_phones, COALESCE(v_pax->>'phone', ''));
  END LOOP;

  IF array_length(v_seat_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'ERR_NO_SEATS: At least one seat is required';
  END IF;

  v_booker_name := NULLIF(btrim(COALESCE(v_link.link_data->>'booker_name', '')), '');
  v_booker_document := NULLIF(btrim(COALESCE(v_link.link_data->>'booker_document', '')), '');
  v_booker_phone := COALESCE(v_link.link_data->>'booker_phone', '');
  IF v_booker_name IS NULL OR v_booker_document IS NULL THEN
    RAISE EXCEPTION 'ERR_PASSENGER_INCOMPLETE: Booker name and document are required';
  END IF;

  PERFORM 1 FROM public.seats WHERE id = ANY(v_seat_ids) ORDER BY id FOR UPDATE;

  FOR v_seat IN
    SELECT id, seat_code, status, locked_by, lock_expires_at
    FROM public.seats
    WHERE id = ANY(v_seat_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF NOT (
      v_seat.status = 'locked'
      AND public.reservation_link_agency_owns_lock(v_seat.locked_by, p_agency_id)
      AND v_seat.lock_expires_at IS NOT NULL
      AND v_seat.lock_expires_at > NOW()
    ) THEN
      RAISE EXCEPTION 'ERR_SEAT_INVALID_LOCK: Seat % does not have a valid agency lock',
        v_seat.seat_code;
    END IF;
  END LOOP;

  v_result := public.create_reservation_core(
    v_link.trip_id, p_agency_id, p_created_by,
    v_booker_name, v_booker_document, v_booker_phone,
    v_seat_ids, v_names, v_docs, v_phones
  );

  UPDATE public.reservation_links SET status = 'confirmed' WHERE id = p_link_id;

  PERFORM public.emit_reservation_link_event(
    'reservation_link.confirmed',
    p_link_id,
    p_agency_id,
    jsonb_build_object(
      'link_id', p_link_id,
      'trip_id', v_link.trip_id,
      'agency_id', p_agency_id,
      'reservation_id', v_result->>'reservation_id'
    ),
    'reservation_link.confirmed:' || p_link_id::text
  );

  PERFORM public.audit_append(
    p_created_by, 'agency', p_agency_id,
    'reservation_link.confirmed', 'reservation_link', p_link_id,
    NULL, jsonb_build_object('reservation_id', v_result->>'reservation_id'),
    '{}'::jsonb
  );

  RETURN v_result;
END;
$$;

-- ── 5) regenerate_reservation_link ───────────────────────────

CREATE OR REPLACE FUNCTION public.regenerate_reservation_link(
  p_old_link_id UUID,
  p_agency_id UUID,
  p_created_by UUID,
  p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old public.reservation_links;
  v_code TEXT;
  v_seat RECORD;
  v_seat_ids UUID[] := ARRAY[]::UUID[];
  v_codes TEXT[] := ARRAY[]::TEXT[];
  v_new_id UUID;
  v_expires TIMESTAMPTZ;
  v_snapshot JSONB;
  v_departure TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_old
  FROM public.reservation_links
  WHERE id = p_old_link_id
  FOR UPDATE;

  IF NOT FOUND OR v_old.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_LINK_NOT_FOUND: Link not found';
  END IF;

  v_code := public.reservation_link_apply_lazy(p_old_link_id);
  IF v_code IS NOT NULL THEN
    IF v_code = 'LINK_EXPIRED' THEN
      RAISE EXCEPTION 'ERR_LINK_EXPIRED: Link has expired';
    ELSIF v_code = 'LINK_CONFIRMED' THEN
      RAISE EXCEPTION 'ERR_LINK_CONFIRMED: Link already confirmed';
    ELSIF v_code = 'LINK_CANCELLED' THEN
      RAISE EXCEPTION 'ERR_LINK_CANCELLED: Link was cancelled';
    ELSIF v_code = 'TRIP_MISSING' THEN
      RAISE EXCEPTION 'ERR_TRIP_MISSING: Trip is no longer available';
    ELSIF v_code = 'TRIP_CHANGED' THEN
      RAISE EXCEPTION 'ERR_TRIP_CHANGED: Trip was modified';
    ELSE
      RAISE EXCEPTION 'ERR_LINK_NOT_FOUND: Link not found';
    END IF;
  END IF;

  SELECT departure_time INTO v_departure FROM public.trips WHERE id = v_old.trip_id;
  IF v_departure <= NOW() THEN
    RAISE EXCEPTION 'ERR_TRIP_DEPARTED: Cannot create a reservation after departure time';
  END IF;

  FOR v_seat IN
    SELECT rls.seat_id, rls.seat_code
    FROM public.reservation_link_seats rls
    WHERE rls.link_id = p_old_link_id
    ORDER BY rls.seat_code
  LOOP
    IF v_seat.seat_id IS NULL THEN
      RAISE EXCEPTION 'ERR_SEAT_INVALID_LOCK: Seat % no longer exists', v_seat.seat_code;
    END IF;
    v_seat_ids := array_append(v_seat_ids, v_seat.seat_id);
    v_codes := array_append(v_codes, v_seat.seat_code);
  END LOOP;

  PERFORM 1 FROM public.seats WHERE id = ANY(v_seat_ids) ORDER BY id FOR UPDATE;

  FOR v_seat IN
    SELECT id, seat_code, status, locked_by, lock_expires_at
    FROM public.seats
    WHERE id = ANY(v_seat_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF NOT (
      v_seat.status = 'locked'
      AND public.reservation_link_agency_owns_lock(v_seat.locked_by, p_agency_id)
      AND v_seat.lock_expires_at IS NOT NULL
      AND v_seat.lock_expires_at > NOW()
    ) THEN
      RAISE EXCEPTION 'ERR_SEAT_INVALID_LOCK: Seat % does not have a valid agency lock',
        v_seat.seat_code;
    END IF;
  END LOOP;

  UPDATE public.reservation_links SET status = 'cancelled' WHERE id = p_old_link_id;

  v_snapshot := public.reservation_link_trip_snapshot(v_old.trip_id);
  UPDATE public.seats
  SET lock_expires_at = NOW() + INTERVAL '900 seconds'
  WHERE id = ANY(v_seat_ids)
    AND status = 'locked'
    AND public.reservation_link_agency_owns_lock(locked_by, p_agency_id)
    AND lock_expires_at > NOW();

  v_new_id := gen_random_uuid();
  v_expires := NOW() + INTERVAL '900 seconds';

  INSERT INTO public.reservation_links (
    id, token_hash, trip_id, agency_id, created_by,
    status, expires_at, link_data, trip_snapshot
  ) VALUES (
    v_new_id, p_token_hash, v_old.trip_id, p_agency_id, p_created_by,
    'active', v_expires, v_old.link_data, v_snapshot
  );

  BEGIN
    INSERT INTO public.reservation_link_seats (link_id, seat_id, seat_code)
    SELECT v_new_id, rls.seat_id, rls.seat_code
    FROM public.reservation_link_seats rls
    WHERE rls.link_id = p_old_link_id
    ORDER BY rls.seat_code;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'ERR_SEAT_ACTIVE_LINK: Seat already in an active link';
  END;

  PERFORM public.emit_reservation_link_event(
    'reservation_link.cancelled',
    p_old_link_id,
    p_agency_id,
    jsonb_build_object('link_id', p_old_link_id, 'trip_id', v_old.trip_id, 'agency_id', p_agency_id),
    'reservation_link.cancelled:' || p_old_link_id::text
  );
  PERFORM public.emit_reservation_link_event(
    'reservation_link.created',
    v_new_id,
    p_agency_id,
    jsonb_build_object('link_id', v_new_id, 'trip_id', v_old.trip_id, 'agency_id', p_agency_id),
    'reservation_link.created:' || v_new_id::text
  );
  PERFORM public.audit_append(
    p_created_by, 'agency', p_agency_id,
    'reservation_link.regenerated', 'reservation_link', v_new_id,
    NULL, jsonb_build_object('old_link_id', p_old_link_id, 'new_link_id', v_new_id),
    '{}'::jsonb
  );

  RETURN jsonb_build_object(
    'link_id', v_new_id,
    'seat_codes', to_jsonb(v_codes),
    'expires_at', v_expires,
    'inherited_data', COALESCE(v_old.link_data, '{}'::jsonb)
  );
END;
$$;

-- ── 6) cancel_reservation_link ───────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_reservation_link(
  p_link_id UUID,
  p_agency_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.reservation_links;
  v_actor UUID;
BEGIN
  SELECT * INTO v_link
  FROM public.reservation_links
  WHERE id = p_link_id
  FOR UPDATE;

  IF NOT FOUND OR v_link.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_LINK_NOT_FOUND: Link not found';
  END IF;

  IF v_link.status IN ('expired', 'cancelled', 'confirmed') THEN
    RAISE EXCEPTION 'ERR_LINK_NOT_FOUND: Link not found';
  END IF;

  -- status = active, including lazy-expired TTL (B13)
  UPDATE public.seats
  SET status = 'available',
      locked_by = NULL,
      locked_at = NULL,
      lock_expires_at = NULL
  WHERE id IN (SELECT seat_id FROM public.reservation_link_seats WHERE link_id = p_link_id)
    AND status = 'locked'
    AND public.reservation_link_agency_owns_lock(locked_by, p_agency_id);

  UPDATE public.reservation_links SET status = 'cancelled' WHERE id = p_link_id;

  PERFORM public.emit_reservation_link_event(
    'reservation_link.cancelled',
    p_link_id,
    p_agency_id,
    jsonb_build_object('link_id', p_link_id, 'trip_id', v_link.trip_id, 'agency_id', p_agency_id),
    'reservation_link.cancelled:' || p_link_id::text
  );

  v_actor := v_link.created_by;
  PERFORM public.audit_append(
    v_actor, 'agency', p_agency_id,
    'reservation_link.cancelled', 'reservation_link', p_link_id,
    NULL, jsonb_build_object('status', 'cancelled'),
    '{}'::jsonb
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── 7) Public GET / SAVE ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.public_get_reservation_link(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.reservation_links;
  v_code TEXT;
BEGIN
  SELECT * INTO v_link
  FROM public.reservation_links
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'LINK_NOT_FOUND', 'body', NULL);
  END IF;

  v_code := public.reservation_link_apply_lazy(v_link.id);
  IF v_code IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', v_code, 'body', NULL);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'error_code', NULL,
    'body', public.reservation_link_public_body(v_link.id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.public_save_reservation_link(
  p_token_hash TEXT,
  p_link_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.reservation_links;
  v_code TEXT;
  v_codes TEXT[];
  v_clean JSONB;
  v_had_data BOOLEAN;
BEGIN
  SELECT * INTO v_link
  FROM public.reservation_links
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'LINK_NOT_FOUND', 'body', NULL);
  END IF;

  v_code := public.reservation_link_apply_lazy(v_link.id);
  IF v_code IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', v_code, 'body', NULL);
  END IF;

  SELECT * INTO v_link FROM public.reservation_links WHERE id = v_link.id;

  SELECT COALESCE(array_agg(rls.seat_code ORDER BY rls.seat_code), ARRAY[]::TEXT[])
    INTO v_codes
  FROM public.reservation_link_seats rls
  WHERE rls.link_id = v_link.id;

  v_clean := public.reservation_link_sanitize_link_data(p_link_data, v_codes);
  v_had_data := COALESCE(v_link.link_data, '{}'::jsonb) <> '{}'::jsonb
    AND COALESCE(v_link.link_data->'passengers', '[]'::jsonb) <> '[]'::jsonb;

  UPDATE public.reservation_links
  SET link_data = v_clean
  WHERE id = v_link.id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'LINK_CANCELLED', 'body', NULL);
  END IF;

  IF NOT v_had_data THEN
    PERFORM public.emit_reservation_link_event(
      'reservation_link.passenger_data_saved',
      v_link.id,
      v_link.agency_id,
      jsonb_build_object('link_id', v_link.id, 'trip_id', v_link.trip_id, 'agency_id', v_link.agency_id),
      'reservation_link.passenger_data_saved:' || v_link.id::text
    );
    PERFORM public.audit_append(
      NULL, 'system', v_link.agency_id,
      'reservation_link.passenger_data_saved', 'reservation_link', v_link.id,
      NULL, jsonb_build_object('status', 'saved'), '{}'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'error_code', NULL,
    'body', public.reservation_link_public_body(v_link.id)
  );
END;
$$;

-- ── 8) patch_reservation_link_data ───────────────────────────

CREATE OR REPLACE FUNCTION public.patch_reservation_link_data(
  p_link_id UUID,
  p_agency_id UUID,
  p_link_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.reservation_links;
  v_code TEXT;
  v_codes TEXT[];
  v_clean JSONB;
BEGIN
  SELECT * INTO v_link
  FROM public.reservation_links
  WHERE id = p_link_id
  FOR UPDATE;

  IF NOT FOUND OR v_link.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_LINK_NOT_FOUND: Link not found';
  END IF;

  v_code := public.reservation_link_apply_lazy(p_link_id);
  IF v_code IS NOT NULL THEN
    IF v_code = 'LINK_EXPIRED' THEN
      RAISE EXCEPTION 'ERR_LINK_EXPIRED: Link has expired';
    ELSIF v_code = 'LINK_CONFIRMED' THEN
      RAISE EXCEPTION 'ERR_LINK_CONFIRMED: Link already confirmed';
    ELSIF v_code = 'LINK_CANCELLED' THEN
      RAISE EXCEPTION 'ERR_LINK_CANCELLED: Link was cancelled';
    ELSIF v_code = 'TRIP_MISSING' THEN
      RAISE EXCEPTION 'ERR_TRIP_MISSING: Trip is no longer available';
    ELSIF v_code = 'TRIP_CHANGED' THEN
      RAISE EXCEPTION 'ERR_TRIP_CHANGED: Trip was modified';
    ELSE
      RAISE EXCEPTION 'ERR_LINK_NOT_FOUND: Link not found';
    END IF;
  END IF;

  SELECT COALESCE(array_agg(rls.seat_code ORDER BY rls.seat_code), ARRAY[]::TEXT[])
    INTO v_codes
  FROM public.reservation_link_seats rls
  WHERE rls.link_id = p_link_id;

  v_clean := public.reservation_link_sanitize_link_data(p_link_data, v_codes);

  UPDATE public.reservation_links
  SET link_data = v_clean
  WHERE id = p_link_id AND agency_id = p_agency_id AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_LINK_NOT_FOUND: Link not found';
  END IF;

  RETURN COALESCE(v_clean, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.reservation_link_materialize_agency(p_agency_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  FOR v_id IN
    SELECT id FROM public.reservation_links
    WHERE agency_id = p_agency_id AND status = 'active'
    FOR UPDATE
  LOOP
    PERFORM public.reservation_link_apply_lazy(v_id);
  END LOOP;
END;
$$;

-- ── 9) Capacity shrink: active link seats are in-use ─────────

CREATE OR REPLACE FUNCTION public.trg_seats_block_delete_active_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reservation_link_seats
    WHERE seat_id = OLD.id AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'ERR_SEATS_IN_USE: No se puede reducir capacidad: hay un enlace activo en esos asientos';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_seats_block_delete_active_link ON public.seats;
CREATE TRIGGER trg_seats_block_delete_active_link
  BEFORE DELETE ON public.seats
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_seats_block_delete_active_link();

-- ── 10) Grants ───────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'emit_reservation_link_event',
        'reservation_link_trip_snapshot',
        'reservation_link_trip_diverged',
        'reservation_link_agency_owns_lock',
        'reservation_link_apply_lazy',
        'reservation_link_sanitize_link_data',
        'reservation_link_public_body',
        'create_reservation_core',
        'create_agency_reservation',
        'create_reservation_link',
        'confirm_reservation_from_link',
        'regenerate_reservation_link',
        'cancel_reservation_link',
        'public_get_reservation_link',
        'public_save_reservation_link',
        'patch_reservation_link_data',
        'reservation_link_materialize_agency',
        'trg_seats_block_delete_active_link'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

