-- ============================================================
-- WKR-008 — schedule_trip_reminders behavioral verification
--
-- Prerequisites: migrations through 059 applied (incl. emit_trip_event,
-- create_trip / set_trip_status from 057, schedule_trip_reminders from 059).
-- Non-destructive: one outer transaction; script always ends with ROLLBACK.
--
-- Verifies:
--   A) T-48 (~36h) → window t48
--   B) T-24 (~12h) → window t24
--   C) Outside window (>48h) → no reminder
--   D) Already departed (departure <= now) → no reminder
--   E) Catch-up in T-24 without prior t48 → only t24
--   F) Dedup re-poll → no second outbox row
--   G) Postponement → new departure produces new dedup_keys
--   H) Restore exact original departure → historical dedup blocks re-emit
--   I) cancelled / completed / archived → no reminder
--   J) p_batch limit respected
--   K) Function body has only t48|t24 windows (no t2/t22)
-- ============================================================

BEGIN;

-- K) Surface + window literals (no t22 / t2).
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'schedule_trip_reminders'
    AND p.pronargs = 1
    AND p.proargtypes[0] = 'int4'::regtype;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'FAIL: K) schedule_trip_reminders(integer) not found';
  END IF;

  -- Tagged $re$...$re$ patterns: avoid nesting bare dollar-dollar inside DO body.
  IF v_def !~ $re$'t48'$re$ OR v_def !~ $re$'t24'$re$ THEN
    RAISE EXCEPTION 'FAIL: K) expected t48 and t24 literals in function body';
  END IF;

  IF v_def ~* $re$'t22'$re$ OR v_def ~* $re$trip_reminder_t22$re$ THEN
    RAISE EXCEPTION 'FAIL: K) forbidden t22 literal present in function body';
  END IF;

  -- Reject a bare t2 window, but allow INTERVAL '24 hours' / '48 hours'.
  IF v_def ~ $re$'t2'$re$ THEN
    RAISE EXCEPTION 'FAIL: K) forbidden t2 window literal present';
  END IF;

  IF v_def !~* 'FOR UPDATE OF t' THEN
    RAISE EXCEPTION 'FAIL: K) expected FOR UPDATE OF t for TOCTOU safety';
  END IF;

  IF v_def !~* 'NOT EXISTS' THEN
    RAISE EXCEPTION 'FAIL: K) expected NOT EXISTS dedup pre-filter';
  END IF;

  RAISE NOTICE 'PASS: K) schedule_trip_reminders surface: t48/t24 only, FOR UPDATE, NOT EXISTS';
END $$;

-- A) T-48
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_id UUID;
  v_dep TIMESTAMPTZ := clock_timestamp() + INTERVAL '36 hours';
  v_result JSONB;
  v_event public.outbox_events%ROWTYPE;
  v_count INTEGER;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (
    v_agency,
    'WKR008 A Agency',
    'w8a-' || LEFT(REPLACE(v_agency::text, '-', ''), 16),
    NULL,
    'active'
  );
  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'W8A Origin', 'W8A Destination', 'active');

  v_trip_id := (public.create_trip(
    v_route, v_dep, 'kia', ARRAY[v_agency], NULL
  )->>'id')::UUID;

  -- Pin exact departure used by create_trip (may have microsecond drift).
  SELECT departure_time INTO v_dep FROM public.trips WHERE id = v_trip_id;

  v_result := public.schedule_trip_reminders(50);

  SELECT COUNT(*) INTO v_count
  FROM public.outbox_events
  WHERE event_type = 'trip.reminder_due' AND aggregate_id = v_trip_id;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: A) expected 1 reminder event, found % (rpc=%)',
      v_count, v_result;
  END IF;

  SELECT * INTO STRICT v_event
  FROM public.outbox_events
  WHERE event_type = 'trip.reminder_due' AND aggregate_id = v_trip_id;

  IF v_event.payload->>'window' <> 't48'
    OR v_event.tenant_id IS NOT NULL
    OR v_event.dedup_key <> 'trip.reminder_due:' || v_trip_id::text
      || ':t48:'
      || to_char(v_dep AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  THEN
    RAISE EXCEPTION 'FAIL: A) t48 envelope mismatch: % / %',
      v_event.payload, v_event.dedup_key;
  END IF;

  RAISE NOTICE 'PASS: A) ~36h active trip emits t48';
END $$;

-- B) T-24
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_id UUID;
  v_dep TIMESTAMPTZ := clock_timestamp() + INTERVAL '12 hours';
  v_event public.outbox_events%ROWTYPE;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (
    v_agency,
    'WKR008 B Agency',
    'w8b-' || LEFT(REPLACE(v_agency::text, '-', ''), 16),
    NULL,
    'active'
  );
  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'W8B Origin', 'W8B Destination', 'active');

  v_trip_id := (public.create_trip(
    v_route, v_dep, 'kia', ARRAY[v_agency], NULL
  )->>'id')::UUID;

  PERFORM public.schedule_trip_reminders(50);

  SELECT * INTO STRICT v_event
  FROM public.outbox_events
  WHERE event_type = 'trip.reminder_due' AND aggregate_id = v_trip_id;

  IF v_event.payload->>'window' <> 't24' THEN
    RAISE EXCEPTION 'FAIL: B) expected t24, got %', v_event.payload->>'window';
  END IF;

  RAISE NOTICE 'PASS: B) ~12h active trip emits t24';
END $$;

-- C) Outside window (>48h)
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_id UUID;
  v_count INTEGER;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (
    v_agency,
    'WKR008 C Agency',
    'w8c-' || LEFT(REPLACE(v_agency::text, '-', ''), 16),
    NULL,
    'active'
  );
  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'W8C Origin', 'W8C Destination', 'active');

  v_trip_id := (public.create_trip(
    v_route,
    clock_timestamp() + INTERVAL '72 hours',
    'kia',
    ARRAY[v_agency],
    NULL
  )->>'id')::UUID;

  PERFORM public.schedule_trip_reminders(50);

  SELECT COUNT(*) INTO v_count
  FROM public.outbox_events
  WHERE event_type = 'trip.reminder_due' AND aggregate_id = v_trip_id;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: C) expected 0 reminders outside 48h, found %', v_count;
  END IF;

  RAISE NOTICE 'PASS: C) departure > 48h emits nothing';
END $$;

-- D) Already departed
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_id UUID;
  v_count INTEGER;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (
    v_agency,
    'WKR008 D Agency',
    'w8d-' || LEFT(REPLACE(v_agency::text, '-', ''), 16),
    NULL,
    'active'
  );
  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'W8D Origin', 'W8D Destination', 'active');

  v_trip_id := (public.create_trip(
    v_route,
    clock_timestamp() + INTERVAL '30 hours',
    'kia',
    ARRAY[v_agency],
    NULL
  )->>'id')::UUID;

  UPDATE public.trips
  SET departure_time = clock_timestamp() - INTERVAL '1 hour'
  WHERE id = v_trip_id;

  PERFORM public.schedule_trip_reminders(50);

  SELECT COUNT(*) INTO v_count
  FROM public.outbox_events
  WHERE event_type = 'trip.reminder_due' AND aggregate_id = v_trip_id;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: D) expected 0 reminders for departed trip, found %',
      v_count;
  END IF;

  RAISE NOTICE 'PASS: D) departure <= now emits nothing';
END $$;

-- E) Catch-up: already in T-24 without prior t48 → only t24
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_id UUID;
  v_count INTEGER;
  v_windows TEXT[];
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (
    v_agency,
    'WKR008 E Agency',
    'w8e-' || LEFT(REPLACE(v_agency::text, '-', ''), 16),
    NULL,
    'active'
  );
  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'W8E Origin', 'W8E Destination', 'active');

  v_trip_id := (public.create_trip(
    v_route,
    clock_timestamp() + INTERVAL '10 hours',
    'kia',
    ARRAY[v_agency],
    NULL
  )->>'id')::UUID;

  PERFORM public.schedule_trip_reminders(50);

  SELECT COUNT(*), array_agg(payload->>'window' ORDER BY payload->>'window')
  INTO v_count, v_windows
  FROM public.outbox_events
  WHERE event_type = 'trip.reminder_due' AND aggregate_id = v_trip_id;

  IF v_count <> 1 OR v_windows <> ARRAY['t24'] THEN
    RAISE EXCEPTION 'FAIL: E) catch-up expected only [t24], got count=% windows=%',
      v_count, v_windows;
  END IF;

  RAISE NOTICE 'PASS: E) catch-up emits only t24 (no retrospective t48)';
END $$;

-- F) Dedup re-poll
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_id UUID;
  v_count INTEGER;
  v_result JSONB;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (
    v_agency,
    'WKR008 F Agency',
    'w8f-' || LEFT(REPLACE(v_agency::text, '-', ''), 16),
    NULL,
    'active'
  );
  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'W8F Origin', 'W8F Destination', 'active');

  v_trip_id := (public.create_trip(
    v_route,
    clock_timestamp() + INTERVAL '36 hours',
    'kia',
    ARRAY[v_agency],
    NULL
  )->>'id')::UUID;

  PERFORM public.schedule_trip_reminders(50);
  v_result := public.schedule_trip_reminders(50);

  SELECT COUNT(*) INTO v_count
  FROM public.outbox_events
  WHERE event_type = 'trip.reminder_due' AND aggregate_id = v_trip_id;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: F) expected 1 event after re-poll, found % (rpc=%)',
      v_count, v_result;
  END IF;

  IF (v_result->>'emitted')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'FAIL: F) re-poll should emit 0, got %', v_result;
  END IF;

  RAISE NOTICE 'PASS: F) re-poll is idempotent (dedup_key)';
END $$;

-- G) Postponement → new keys for new departure
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_id UUID;
  v_old TIMESTAMPTZ;
  v_new TIMESTAMPTZ := clock_timestamp() + INTERVAL '40 hours';
  v_count INTEGER;
  v_keys TEXT[];
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (
    v_agency,
    'WKR008 G Agency',
    'w8g-' || LEFT(REPLACE(v_agency::text, '-', ''), 16),
    NULL,
    'active'
  );
  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'W8G Origin', 'W8G Destination', 'active');

  v_trip_id := (public.create_trip(
    v_route,
    clock_timestamp() + INTERVAL '30 hours',
    'kia',
    ARRAY[v_agency],
    NULL
  )->>'id')::UUID;

  SELECT departure_time INTO v_old FROM public.trips WHERE id = v_trip_id;

  PERFORM public.schedule_trip_reminders(50);

  UPDATE public.trips
  SET departure_time = v_new
  WHERE id = v_trip_id;

  SELECT departure_time INTO v_new FROM public.trips WHERE id = v_trip_id;

  PERFORM public.schedule_trip_reminders(50);

  SELECT COUNT(*), array_agg(dedup_key ORDER BY created_at)
  INTO v_count, v_keys
  FROM public.outbox_events
  WHERE event_type = 'trip.reminder_due' AND aggregate_id = v_trip_id;

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: G) expected 2 reminder events after postpone, found %',
      v_count;
  END IF;

  IF v_keys[1] = v_keys[2] THEN
    RAISE EXCEPTION 'FAIL: G) expected distinct dedup_keys after postpone: %',
      v_keys;
  END IF;

  IF position(
    to_char(v_old AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    IN v_keys[1]
  ) = 0 THEN
    RAISE EXCEPTION 'FAIL: G) old departure missing from first key: %', v_keys[1];
  END IF;

  IF position(
    to_char(v_new AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    IN v_keys[2]
  ) = 0 THEN
    RAISE EXCEPTION 'FAIL: G) new departure missing from second key: %', v_keys[2];
  END IF;

  RAISE NOTICE 'PASS: G) postponement creates new dedup_keys';
END $$;

-- H) Restore exact original departure → historical dedup blocks re-emit
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_id UUID;
  v_original TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (
    v_agency,
    'WKR008 H Agency',
    'w8h-' || LEFT(REPLACE(v_agency::text, '-', ''), 16),
    NULL,
    'active'
  );
  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'W8H Origin', 'W8H Destination', 'active');

  v_trip_id := (public.create_trip(
    v_route,
    clock_timestamp() + INTERVAL '32 hours',
    'kia',
    ARRAY[v_agency],
    NULL
  )->>'id')::UUID;

  SELECT departure_time INTO v_original FROM public.trips WHERE id = v_trip_id;

  PERFORM public.schedule_trip_reminders(50);

  UPDATE public.trips
  SET departure_time = clock_timestamp() + INTERVAL '38 hours'
  WHERE id = v_trip_id;

  PERFORM public.schedule_trip_reminders(50);

  UPDATE public.trips
  SET departure_time = v_original
  WHERE id = v_trip_id;

  PERFORM public.schedule_trip_reminders(50);

  SELECT COUNT(*) INTO v_count
  FROM public.outbox_events
  WHERE event_type = 'trip.reminder_due' AND aggregate_id = v_trip_id;

  -- original t48 + postponed t48 = 2; restore must not add a third for original.
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: H) expected 2 events after restore (no re-emit), found %',
      v_count;
  END IF;

  RAISE NOTICE 'PASS: H) restoring original departure does not re-emit';
END $$;

-- I) Ineligible statuses
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_cancelled UUID;
  v_trip_completed UUID;
  v_trip_archived UUID;
  v_count INTEGER;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (
    v_agency,
    'WKR008 I Agency',
    'w8i-' || LEFT(REPLACE(v_agency::text, '-', ''), 16),
    NULL,
    'active'
  );
  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'W8I Origin', 'W8I Destination', 'active');

  v_trip_cancelled := (public.create_trip(
    v_route,
    clock_timestamp() + INTERVAL '20 hours',
    'kia',
    ARRAY[v_agency],
    NULL
  )->>'id')::UUID;

  v_trip_completed := (public.create_trip(
    v_route,
    clock_timestamp() + INTERVAL '22 hours',
    'kia',
    ARRAY[v_agency],
    NULL
  )->>'id')::UUID;

  v_trip_archived := (public.create_trip(
    v_route,
    clock_timestamp() + INTERVAL '18 hours',
    'kia',
    ARRAY[v_agency],
    NULL
  )->>'id')::UUID;

  UPDATE public.trips SET status = 'cancelled' WHERE id = v_trip_cancelled;
  UPDATE public.trips SET status = 'completed' WHERE id = v_trip_completed;
  UPDATE public.trips SET status = 'archived' WHERE id = v_trip_archived;

  PERFORM public.schedule_trip_reminders(50);

  SELECT COUNT(*) INTO v_count
  FROM public.outbox_events
  WHERE event_type = 'trip.reminder_due'
    AND aggregate_id IN (v_trip_cancelled, v_trip_completed, v_trip_archived);

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: I) ineligible statuses produced % reminders', v_count;
  END IF;

  RAISE NOTICE 'PASS: I) cancelled/completed/archived emit nothing';
END $$;

-- J) Batch limit
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_i INTEGER;
  v_result JSONB;
  v_trip_ids UUID[] := ARRAY[]::UUID[];
  v_id UUID;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (
    v_agency,
    'WKR008 J Agency',
    'w8j-' || LEFT(REPLACE(v_agency::text, '-', ''), 16),
    NULL,
    'active'
  );
  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'W8J Origin', 'W8J Destination', 'active');

  FOR v_i IN 1..5 LOOP
    v_id := (public.create_trip(
      v_route,
      clock_timestamp() + INTERVAL '28 hours' + (v_i * INTERVAL '1 minute'),
      'kia',
      ARRAY[v_agency],
      NULL
    )->>'id')::UUID;
    v_trip_ids := array_append(v_trip_ids, v_id);
  END LOOP;

  v_result := public.schedule_trip_reminders(2);

  IF (v_result->>'batch')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'FAIL: J) expected batch=2, got %', v_result;
  END IF;

  IF (v_result->>'scanned')::INTEGER > 2 THEN
    RAISE EXCEPTION 'FAIL: J) scanned % exceeds p_batch=2', v_result->>'scanned';
  END IF;

  IF (v_result->>'emitted')::INTEGER > 2 THEN
    RAISE EXCEPTION 'FAIL: J) emitted % exceeds p_batch=2', v_result->>'emitted';
  END IF;

  RAISE NOTICE 'PASS: J) p_batch=2 respected (rpc=%)', v_result;
END $$;

ROLLBACK;
