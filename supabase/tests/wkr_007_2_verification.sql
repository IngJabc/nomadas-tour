-- ============================================================
-- WKR-007.2 — reservation.created dedup_key verification
--
-- Prerequisite: migrations 049, 053 and 056 applied.
-- Non-destructive: every test runs inside one transaction and
-- the script always ends with ROLLBACK.
-- ============================================================

BEGIN;

-- A / E) Function retrofit, dedup infrastructure and security posture.
DO $$
DECLARE
  v_definition TEXT;
  v_security_definer BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'outbox_events'
      AND column_name = 'dedup_key'
  ) THEN
    RAISE EXCEPTION 'FAIL: outbox_events.dedup_key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_outbox_events_dedup_key_unique'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%WHERE (dedup_key IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION 'FAIL: partial unique dedup_key index is missing';
  END IF;

  SELECT pg_get_functiondef(p.oid), p.prosecdef
  INTO v_definition, v_security_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'outbox_emit_reservation_created'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'FAIL: outbox_emit_reservation_created() is missing';
  END IF;

  IF NOT v_security_definer THEN
    RAISE EXCEPTION 'FAIL: outbox_emit_reservation_created() is not SECURITY DEFINER';
  END IF;

  IF v_definition NOT ILIKE '%dedup_key%'
    OR v_definition NOT ILIKE '%reservation.created:%'
    OR v_definition NOT ILIKE '%ON CONFLICT DO NOTHING%'
  THEN
    RAISE EXCEPTION 'FAIL: function does not contain the WKR-007.2 dedup retrofit';
  END IF;

  IF v_definition ~* 'ON\s+CONFLICT\s*(\(|ON\s+CONSTRAINT)' THEN
    RAISE EXCEPTION 'FAIL: ON CONFLICT must not declare a conflict_target';
  END IF;

  RAISE NOTICE 'PASS: A/E) migration 056 function retrofit + SECURITY DEFINER';
END $$;

-- B / C / D / F) Trigger behavior, duplicate suppression and legacy NULLs.
DO $$
DECLARE
  v_agency_id UUID := gen_random_uuid();
  v_route_id UUID := gen_random_uuid();
  v_trip_id UUID := gen_random_uuid();
  v_reservation_id UUID := gen_random_uuid();
  v_legacy_aggregate UUID := gen_random_uuid();
  v_expected_key TEXT;
  v_event public.outbox_events%ROWTYPE;
  v_count INTEGER;
BEGIN
  v_expected_key := 'reservation.created:' || v_reservation_id::text;

  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (
    v_agency_id,
    'WKR-007.2 Verification Agency',
    'wkr0072-' || LEFT(REPLACE(v_agency_id::text, '-', ''), 16),
    NULL,
    'active'
  );

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (
    v_route_id,
    'WKR-007.2 Origin',
    'WKR-007.2 Destination',
    'active'
  );

  INSERT INTO public.trips (
    id, route_id, departure_time, capacity, vehicle_type, status
  ) VALUES (
    v_trip_id,
    v_route_id,
    clock_timestamp() + INTERVAL '7 days',
    10,
    'kia',
    'active'
  );

  INSERT INTO public.trip_agencies (trip_id, agency_id)
  VALUES (v_trip_id, v_agency_id);

  INSERT INTO public.reservations (
    id,
    trip_id,
    agency_id,
    booker_name,
    booker_document,
    booker_phone,
    qr_code,
    ticket_code,
    status
  ) VALUES (
    v_reservation_id,
    v_trip_id,
    v_agency_id,
    'WKR-007.2 Booker',
    'WKR0072-DOC',
    NULL,
    'WKR0072-' || v_reservation_id::text,
    UPPER(LEFT(REPLACE(v_reservation_id::text, '-', ''), 8)),
    'confirmed'
  );

  SELECT *
  INTO STRICT v_event
  FROM public.outbox_events
  WHERE dedup_key = v_expected_key;

  IF v_event.dedup_key <> v_expected_key THEN
    RAISE EXCEPTION 'FAIL: B) unexpected dedup_key: %', v_event.dedup_key;
  END IF;

  IF v_event.event_type <> 'reservation.created'
    OR v_event.event_version <> 1
    OR v_event.aggregate_type <> 'reservation'
    OR v_event.aggregate_id <> v_reservation_id
    OR v_event.tenant_id <> v_agency_id
    OR v_event.payload <> jsonb_build_object(
      'reservation_id', v_reservation_id,
      'trip_id', v_trip_id,
      'agency_id', v_agency_id
    )
  THEN
    RAISE EXCEPTION 'FAIL: F) reservation.created envelope changed';
  END IF;

  -- Reinsert the same logical reservation. The reservation row is removed,
  -- but its first outbox fact remains; the second trigger publication must
  -- be ignored by dedup_key + ON CONFLICT DO NOTHING.
  DELETE FROM public.reservations WHERE id = v_reservation_id;

  INSERT INTO public.reservations (
    id,
    trip_id,
    agency_id,
    booker_name,
    booker_document,
    booker_phone,
    qr_code,
    ticket_code,
    status
  ) VALUES (
    v_reservation_id,
    v_trip_id,
    v_agency_id,
    'WKR-007.2 Booker',
    'WKR0072-DOC',
    NULL,
    'WKR0072-' || v_reservation_id::text,
    UPPER(LEFT(REPLACE(v_reservation_id::text, '-', ''), 8)),
    'confirmed'
  );

  SELECT COUNT(*)
  INTO v_count
  FROM public.outbox_events
  WHERE dedup_key = v_expected_key;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: C) expected one outbox row, found %', v_count;
  END IF;

  INSERT INTO public.outbox_events (
    event_type,
    event_version,
    aggregate_type,
    aggregate_id,
    tenant_id,
    payload,
    dedup_key
  ) VALUES
    (
      'test.wkr0072.legacy',
      1,
      'test',
      v_legacy_aggregate,
      NULL,
      '{}'::jsonb,
      NULL
    ),
    (
      'test.wkr0072.legacy',
      1,
      'test',
      v_legacy_aggregate,
      NULL,
      '{}'::jsonb,
      NULL
    );

  SELECT COUNT(*)
  INTO v_count
  FROM public.outbox_events
  WHERE event_type = 'test.wkr0072.legacy'
    AND aggregate_id = v_legacy_aggregate
    AND dedup_key IS NULL;

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: D) legacy NULL dedup_key rows were constrained';
  END IF;

  RAISE NOTICE 'PASS: B) deterministic reservation.created dedup_key';
  RAISE NOTICE 'PASS: C) duplicate reservation publication suppressed';
  RAISE NOTICE 'PASS: D) legacy NULL dedup_key rows remain valid';
  RAISE NOTICE 'PASS: F) reservation.created envelope remains unchanged';
END $$;

ROLLBACK;

