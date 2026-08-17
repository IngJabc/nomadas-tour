-- ============================================================
-- Reservation departure-time rule — create_agency_reservation
-- Requires migration 066_create_agency_reservation_departed.sql
--
-- Pure SQL: RAISE EXCEPTION on FAIL, RAISE NOTICE on PASS.
-- Non-destructive: outer BEGIN … ROLLBACK (no committed fixtures).
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_suffix TEXT := replace(gen_random_uuid()::text, '-', '');
  v_agency UUID := gen_random_uuid();
  v_super UUID := gen_random_uuid();
  v_user UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_past UUID;
  v_trip_bound UUID;
  v_trip_future UUID;
  v_seat_past UUID;
  v_seat_bound UUID;
  v_seat_future UUID;
  v_res JSONB;
  v_res_id UUID;
  v_res_before INTEGER;
  v_pax_before INTEGER;
  v_outbox_before INTEGER;
  v_audit_before INTEGER;
  v_notif_before INTEGER;
  v_seats_before JSONB;
  v_res_after INTEGER;
  v_pax_after INTEGER;
  v_outbox_after INTEGER;
  v_audit_after INTEGER;
  v_notif_after INTEGER;
  v_seats_after JSONB;
BEGIN
  BEGIN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) VALUES
      (
        '00000000-0000-0000-0000-000000000000', v_super,
        'authenticated', 'authenticated',
        'dep-sa-' || left(v_suffix, 12) || '@example.com',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        NOW(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        NOW(), NOW(), '', '', '', ''
      ),
      (
        '00000000-0000-0000-0000-000000000000', v_user,
        'authenticated', 'authenticated',
        'dep-ag-' || left(v_suffix, 12) || '@example.com',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        NOW(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        NOW(), NOW(), '', '', '', ''
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL: cannot seed auth.users (need postgres/service role): %', SQLERRM;
  END;

  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (
    v_agency,
    'Dep-time Agency',
    'dep-' || left(v_suffix, 16),
    'dep-' || left(v_suffix, 12) || '@example.com',
    'active'
  );

  INSERT INTO public.users (id, email, password_hash, role, agency_id)
  VALUES
    (v_super, 'dep-sa-' || left(v_suffix, 12) || '@example.com', '', 'superadmin', NULL),
    (v_user, 'dep-ag-' || left(v_suffix, 12) || '@example.com', '', 'agency', v_agency);

  INSERT INTO public.agency_settings (agency_id)
  VALUES (v_agency)
  ON CONFLICT (agency_id) DO NOTHING;

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'Dep Origin', 'Dep Dest', 'active');

  -- Case 1: active, departed 1 minute ago
  v_res := public.create_trip(
    v_route,
    NOW() - INTERVAL '1 minute',
    'kia',
    ARRAY[v_agency],
    v_super
  );
  v_trip_past := (v_res->>'id')::UUID;

  -- Case 2: active, unambiguously in the past (covers departure_time <= NOW())
  v_res := public.create_trip(
    v_route,
    NOW() - INTERVAL '1 second',
    'kia',
    ARRAY[v_agency],
    v_super
  );
  v_trip_bound := (v_res->>'id')::UUID;

  -- Case 3: active, future
  v_res := public.create_trip(
    v_route,
    NOW() + INTERVAL '1 hour',
    'kia',
    ARRAY[v_agency],
    v_super
  );
  v_trip_future := (v_res->>'id')::UUID;

  SELECT id INTO v_seat_past
  FROM public.seats WHERE trip_id = v_trip_past ORDER BY seat_code LIMIT 1;
  SELECT id INTO v_seat_bound
  FROM public.seats WHERE trip_id = v_trip_bound ORDER BY seat_code LIMIT 1;
  SELECT id INTO v_seat_future
  FROM public.seats WHERE trip_id = v_trip_future ORDER BY seat_code LIMIT 1;

  -- ── CASE 1: past departure ─────────────────────────────────
  SELECT COUNT(*) INTO v_res_before FROM public.reservations WHERE trip_id = v_trip_past;
  SELECT COUNT(*) INTO v_pax_before
  FROM public.reservation_passengers rp
  JOIN public.reservations r ON r.id = rp.reservation_id
  WHERE r.trip_id = v_trip_past;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'status', status) ORDER BY id), '[]'::jsonb)
    INTO v_seats_before
  FROM public.seats WHERE trip_id = v_trip_past;
  SELECT COUNT(*) INTO v_outbox_before
  FROM public.outbox_events WHERE event_type = 'reservation.created';
  SELECT COUNT(*) INTO v_audit_before
  FROM public.audit_log WHERE action = 'reservation.created';
  SELECT COUNT(*) INTO v_notif_before
  FROM public.notifications WHERE type = 'reservation_created';

  BEGIN
    PERFORM public.create_agency_reservation(
      v_trip_past, v_agency, v_user,
      'Booker Past', 'DOC-P', '555-0001',
      ARRAY[v_seat_past],
      ARRAY['Pax Past'], ARRAY['PD-P'], ARRAY['555-1001']
    );
    RAISE EXCEPTION 'FAIL: C1 expected ERR_TRIP_DEPARTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* 'FAIL: C1' THEN RAISE; END IF;
    IF SQLERRM !~* 'ERR_TRIP_DEPARTED' THEN
      RAISE EXCEPTION 'FAIL: C1 expected ERR_TRIP_DEPARTED, got %', SQLERRM;
    END IF;
  END;

  SELECT COUNT(*) INTO v_res_after FROM public.reservations WHERE trip_id = v_trip_past;
  SELECT COUNT(*) INTO v_pax_after
  FROM public.reservation_passengers rp
  JOIN public.reservations r ON r.id = rp.reservation_id
  WHERE r.trip_id = v_trip_past;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'status', status) ORDER BY id), '[]'::jsonb)
    INTO v_seats_after
  FROM public.seats WHERE trip_id = v_trip_past;
  SELECT COUNT(*) INTO v_outbox_after
  FROM public.outbox_events WHERE event_type = 'reservation.created';
  SELECT COUNT(*) INTO v_audit_after
  FROM public.audit_log WHERE action = 'reservation.created';
  SELECT COUNT(*) INTO v_notif_after
  FROM public.notifications WHERE type = 'reservation_created';

  IF v_res_after <> v_res_before THEN
    RAISE EXCEPTION 'FAIL: C1 must not insert reservations (% → %)', v_res_before, v_res_after;
  END IF;
  IF v_pax_after <> v_pax_before THEN
    RAISE EXCEPTION 'FAIL: C1 must not insert reservation_passengers (% → %)', v_pax_before, v_pax_after;
  END IF;
  IF v_seats_after IS DISTINCT FROM v_seats_before THEN
    RAISE EXCEPTION 'FAIL: C1 must not mutate seats';
  END IF;
  IF v_outbox_after <> v_outbox_before THEN
    RAISE EXCEPTION 'FAIL: C1 must not emit reservation.created outbox (% → %)',
      v_outbox_before, v_outbox_after;
  END IF;
  IF v_audit_after <> v_audit_before THEN
    RAISE EXCEPTION 'FAIL: C1 must not emit reservation.created audit (% → %)',
      v_audit_before, v_audit_after;
  END IF;
  IF v_notif_after <> v_notif_before THEN
    RAISE EXCEPTION 'FAIL: C1 must not emit reservation_created notifications (% → %)',
      v_notif_before, v_notif_after;
  END IF;
  RAISE NOTICE 'PASS: C1 active + departure_time = now()-1min → ERR_TRIP_DEPARTED, zero side effects';

  -- ── CASE 2: boundary (unambiguously <= NOW()) ──────────────
  SELECT COUNT(*) INTO v_res_before FROM public.reservations WHERE trip_id = v_trip_bound;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'status', status) ORDER BY id), '[]'::jsonb)
    INTO v_seats_before
  FROM public.seats WHERE trip_id = v_trip_bound;
  SELECT COUNT(*) INTO v_outbox_before
  FROM public.outbox_events WHERE event_type = 'reservation.created';
  SELECT COUNT(*) INTO v_audit_before
  FROM public.audit_log WHERE action = 'reservation.created';

  BEGIN
    PERFORM public.create_agency_reservation(
      v_trip_bound, v_agency, v_user,
      'Booker Bound', 'DOC-B', '555-0002',
      ARRAY[v_seat_bound],
      ARRAY['Pax Bound'], ARRAY['PD-B'], ARRAY['555-1002']
    );
    RAISE EXCEPTION 'FAIL: C2 expected ERR_TRIP_DEPARTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* 'FAIL: C2' THEN RAISE; END IF;
    IF SQLERRM !~* 'ERR_TRIP_DEPARTED' THEN
      RAISE EXCEPTION 'FAIL: C2 expected ERR_TRIP_DEPARTED, got %', SQLERRM;
    END IF;
  END;

  IF (SELECT COUNT(*) FROM public.reservations WHERE trip_id = v_trip_bound) <> v_res_before THEN
    RAISE EXCEPTION 'FAIL: C2 must not insert reservations';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'status', status) ORDER BY id), '[]'::jsonb)
    INTO v_seats_after
  FROM public.seats WHERE trip_id = v_trip_bound;
  IF v_seats_after IS DISTINCT FROM v_seats_before THEN
    RAISE EXCEPTION 'FAIL: C2 must not mutate seats';
  END IF;
  IF (SELECT COUNT(*) FROM public.outbox_events WHERE event_type = 'reservation.created')
     <> v_outbox_before THEN
    RAISE EXCEPTION 'FAIL: C2 must not emit reservation.created outbox';
  END IF;
  IF (SELECT COUNT(*) FROM public.audit_log WHERE action = 'reservation.created')
     <> v_audit_before THEN
    RAISE EXCEPTION 'FAIL: C2 must not emit reservation.created audit';
  END IF;
  RAISE NOTICE 'PASS: C2 departure_time <= now() → ERR_TRIP_DEPARTED, zero side effects';

  -- ── CASE 3: future departure ───────────────────────────────
  SELECT COUNT(*) INTO v_outbox_before
  FROM public.outbox_events WHERE event_type = 'reservation.created';
  SELECT COUNT(*) INTO v_audit_before
  FROM public.audit_log WHERE action = 'reservation.created';

  v_res := public.create_agency_reservation(
    v_trip_future, v_agency, v_user,
    'Booker Future', 'DOC-F', '555-0003',
    ARRAY[v_seat_future],
    ARRAY['Pax Future'], ARRAY['PD-F'], ARRAY['555-1003']
  );
  v_res_id := (v_res->>'reservation_id')::UUID;
  SET CONSTRAINTS trg_reservations_audit IMMEDIATE;

  IF v_res_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: C3 expected reservation_id';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.reservations
    WHERE id = v_res_id AND trip_id = v_trip_future AND status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'FAIL: C3 reservation row missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.reservation_passengers
    WHERE reservation_id = v_res_id AND seat_id = v_seat_future
  ) THEN
    RAISE EXCEPTION 'FAIL: C3 passenger row missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.seats WHERE id = v_seat_future AND status = 'reserved'
  ) THEN
    RAISE EXCEPTION 'FAIL: C3 seat should be reserved';
  END IF;
  IF (SELECT COUNT(*) FROM public.outbox_events
      WHERE event_type = 'reservation.created' AND aggregate_id = v_res_id) <> 1 THEN
    RAISE EXCEPTION 'FAIL: C3 expected 1 reservation.created outbox';
  END IF;
  IF (SELECT COUNT(*) FROM public.audit_log
      WHERE action = 'reservation.created' AND entity_id = v_res_id) <> 1 THEN
    RAISE EXCEPTION 'FAIL: C3 expected 1 reservation.created audit';
  END IF;
  RAISE NOTICE 'PASS: C3 departure_time = now()+1 hour → reservation created';

  RAISE NOTICE 'PASS: reserv_departure_time_verification';
END $$;

ROLLBACK;
