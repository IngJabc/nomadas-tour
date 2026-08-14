-- ============================================================
-- F4-003 verification harness (BEGIN / ROLLBACK — non-destructive)
-- Requires migration 063 applied. Run manually in Supabase SQL editor
-- when validating production; do NOT leave committed rows.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_is_definer BOOLEAN;
  v_search_path TEXT;
  v_has_execute BOOLEAN;
  v_con TEXT;
  v_route UUID := 'f4003000-0000-4000-8000-000000000001';
  v_trip_a UUID := 'f4003000-0000-4000-8000-000000000011';
  v_trip_b UUID := 'f4003000-0000-4000-8000-000000000012';
  v_trip_c UUID := 'f4003000-0000-4000-8000-000000000013';
  v_result JSONB;
  v_result2 JSONB;
  v_state TEXT;
  v_events INTEGER;
  v_payload JSONB;
  v_eligible INTEGER;
BEGIN
  -- A) RPC posture
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'evaluate_occupancy_alerts'
  ) THEN
    RAISE EXCEPTION 'FAIL: A) evaluate_occupancy_alerts missing';
  END IF;

  SELECT p.prosecdef INTO v_is_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'evaluate_occupancy_alerts';

  IF v_is_definer IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: A) not SECURITY DEFINER';
  END IF;

  SELECT array_to_string(p.proconfig, ',') INTO v_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'evaluate_occupancy_alerts';

  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'FAIL: A) search_path is not public: %', v_search_path;
  END IF;
  RAISE NOTICE 'PASS: A) evaluate_occupancy_alerts DEFINER search_path=public';

  -- B) grants
  SELECT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'evaluate_occupancy_alerts'
      AND grantee = 'service_role'
      AND privilege_type = 'EXECUTE'
  ) INTO v_has_execute;
  IF NOT v_has_execute THEN
    RAISE EXCEPTION 'FAIL: B) service_role missing EXECUTE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'evaluate_occupancy_alerts'
      AND grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: B) public/anon/authenticated have EXECUTE';
  END IF;
  RAISE NOTICE 'PASS: B) RPC EXECUTE grants';

  -- C) state table
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'trip_occupancy_alert_state'
  ) THEN
    RAISE EXCEPTION 'FAIL: C) trip_occupancy_alert_state missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.trip_occupancy_alert_state'::regclass
      AND contype = 'p'
  ) THEN
    RAISE EXCEPTION 'FAIL: C) missing PK';
  END IF;
  RAISE NOTICE 'PASS: C) trip_occupancy_alert_state';

  -- D) agency prefs include occupancy_alerts; superadmin prefs untouched
  SELECT pg_get_constraintdef(oid) INTO v_con
  FROM pg_constraint
  WHERE conname = 'agency_notification_preferences_category_check';
  IF v_con IS NULL OR v_con NOT LIKE '%occupancy_alerts%' THEN
    RAISE EXCEPTION 'FAIL: D) occupancy_alerts missing from agency prefs CHECK';
  END IF;
  IF v_con NOT LIKE '%ops_digest%' THEN
    RAISE EXCEPTION 'FAIL: D) ops_digest dropped from agency prefs CHECK';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_con
  FROM pg_constraint
  WHERE conrelid = 'public.superadmin_notification_preferences'::regclass
    AND conname LIKE '%category%';
  IF v_con LIKE '%occupancy_alerts%' THEN
    RAISE EXCEPTION 'FAIL: D) occupancy_alerts added to superadmin prefs';
  END IF;
  RAISE NOTICE 'PASS: D) prefs scope (agency only)';

  -- E) notifications.type
  SELECT pg_get_constraintdef(oid) INTO v_con
  FROM pg_constraint
  WHERE conname = 'notifications_type_check';
  IF v_con IS NULL OR v_con NOT LIKE '%occupancy_alert%' THEN
    RAISE EXCEPTION 'FAIL: E) occupancy_alert missing from notifications.type';
  END IF;
  IF v_con NOT LIKE '%trip_reminder%' THEN
    RAISE EXCEPTION 'FAIL: E) existing notification types dropped';
  END IF;
  RAISE NOTICE 'PASS: E) notifications.type includes occupancy_alert';

  -- F) no pg_cron in this function source
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'evaluate_occupancy_alerts'
      AND pg_get_functiondef(p.oid) ILIKE '%pg_cron%'
  ) THEN
    RAISE EXCEPTION 'FAIL: F) pg_cron referenced';
  END IF;
  RAISE NOTICE 'PASS: F) no pg_cron';

  -- G) behavioral: near_full enter + idempotent stay + reset + one transition
  INSERT INTO public.routes (id, origin, destination)
  VALUES (v_route, 'F4-003-Origin', 'F4-003-Dest')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.trips (id, route_id, departure_time, capacity, vehicle_type, status)
  VALUES
    (v_trip_a, v_route, NOW() + INTERVAL '2 days', 10, 'kia', 'active'),
    (v_trip_b, v_route, NOW() + INTERVAL '3 days', 10, 'kia', 'active'),
    (v_trip_c, v_route, NOW() + INTERVAL '4 days', 10, 'kia', 'cancelled')
  ON CONFLICT (id) DO NOTHING;

  -- 9/10 reserved → 90% near_full
  INSERT INTO public.seats (trip_id, seat_code, status)
  SELECT v_trip_a, 'A' || g, CASE WHEN g <= 9 THEN 'reserved' ELSE 'available' END
  FROM generate_series(1, 10) g;

  -- 2/10 → 20% underbooked (used later)
  INSERT INTO public.seats (trip_id, seat_code, status)
  SELECT v_trip_b, 'A' || g, CASE WHEN g <= 2 THEN 'reserved' ELSE 'available' END
  FROM generate_series(1, 10) g;

  v_result := public.evaluate_occupancy_alerts(50, NULL, NULL);

  SELECT alert_type INTO v_state
  FROM public.trip_occupancy_alert_state
  WHERE trip_id = v_trip_a;
  IF v_state IS DISTINCT FROM 'near_full' THEN
    RAISE EXCEPTION 'FAIL: G) expected near_full state, got %', v_state;
  END IF;

  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_alert.due'
    AND aggregate_id = v_trip_a;
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'FAIL: G) expected 1 event, got %', v_events;
  END IF;

  SELECT payload INTO v_payload
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_alert.due'
    AND aggregate_id = v_trip_a
  LIMIT 1;
  IF v_payload ? 'transition' THEN
    RAISE EXCEPTION 'FAIL: G) payload must not contain transition';
  END IF;
  IF v_payload ? 'email' OR v_payload ? 'booker_name' THEN
    RAISE EXCEPTION 'FAIL: G) payload contains PII';
  END IF;

  v_result2 := public.evaluate_occupancy_alerts(50, NULL, NULL);
  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_alert.due'
    AND aggregate_id = v_trip_a;
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'FAIL: G) stay re-emitted event';
  END IF;
  RAISE NOTICE 'PASS: G) near_full enter + stay idempotent';

  -- H) reset to NORMAL (84%) then same tick must NOT enter underbooked
  UPDATE public.seats
  SET status = CASE WHEN seat_code IN ('A1') THEN 'reserved' ELSE 'available' END
  WHERE trip_id = v_trip_a;

  v_result := public.evaluate_occupancy_alerts(50, NULL, NULL);
  IF EXISTS (
    SELECT 1 FROM public.trip_occupancy_alert_state WHERE trip_id = v_trip_a
  ) THEN
    RAISE EXCEPTION 'FAIL: H) state should be deleted on reset';
  END IF;
  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_alert.due'
    AND aggregate_id = v_trip_a;
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'FAIL: H) reset must not emit';
  END IF;
  RAISE NOTICE 'PASS: H) one transition per tick (reset only)';

  -- I) next tick enters underbooked
  v_result := public.evaluate_occupancy_alerts(50, NULL, NULL);
  SELECT alert_type INTO v_state
  FROM public.trip_occupancy_alert_state
  WHERE trip_id = v_trip_a;
  IF v_state IS DISTINCT FROM 'underbooked' THEN
    RAISE EXCEPTION 'FAIL: I) expected underbooked on next tick, got %', v_state;
  END IF;
  RAISE NOTICE 'PASS: I) re-entry underbooked on following tick';

  -- J) cleanup cancelled trip state (no event)
  INSERT INTO public.trip_occupancy_alert_state (
    trip_id, alert_type, state, occupancy_pct
  ) VALUES (v_trip_c, 'near_full', 'near_full_alerted', 95);

  v_result := public.evaluate_occupancy_alerts(50, NULL, NULL);
  IF EXISTS (
    SELECT 1 FROM public.trip_occupancy_alert_state WHERE trip_id = v_trip_c
  ) THEN
    RAISE EXCEPTION 'FAIL: J) cancelled trip state not cleaned';
  END IF;
  IF (v_result->>'cleaned_up')::INTEGER < 1 THEN
    RAISE EXCEPTION 'FAIL: J) cleaned_up not incremented';
  END IF;
  RAISE NOTICE 'PASS: J) cleanup cancelled state';

  -- K) keyset fairness: batch=1 advances cursor
  v_result := public.evaluate_occupancy_alerts(1, NULL, NULL);
  IF (v_result->>'has_more')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: K) expected has_more on first page';
  END IF;
  IF v_result->'next_cursor' IS NULL THEN
    RAISE EXCEPTION 'FAIL: K) next_cursor missing';
  END IF;
  v_result2 := public.evaluate_occupancy_alerts(
    1,
    (v_result->'next_cursor'->>'departure_time')::TIMESTAMPTZ,
    (v_result->'next_cursor'->>'id')::UUID
  );
  IF (v_result2->>'scanned')::INTEGER < 1 THEN
    RAISE EXCEPTION 'FAIL: K) second page scanned 0';
  END IF;
  RAISE NOTICE 'PASS: K) keyset pagination';

  -- L) exact-multiple boundary: batch = #eligible trips → has_more must be FALSE
  -- Count real eligible set (harness trips + any pre-existing active future trips).
  -- Hardcoding 2 fails on non-empty DBs (staging/prod).
  -- RPC caps p_batch at 500; when eligible > 500 the full-set exact boundary
  -- cannot be checked in one call — assert has_more TRUE at the cap instead.
  SELECT COUNT(*)::INTEGER INTO v_eligible
  FROM public.trips t
  WHERE t.status = 'active'
    AND t.departure_time > NOW();

  IF v_eligible < 2 THEN
    RAISE EXCEPTION 'FAIL: L) expected >=2 eligible trips (harness A+B), got %', v_eligible;
  END IF;

  IF v_eligible <= 500 THEN
    -- One short of full set → has_more TRUE
    v_result := public.evaluate_occupancy_alerts(v_eligible - 1, NULL, NULL);
    IF (v_result->>'has_more')::BOOLEAN IS NOT TRUE THEN
      RAISE EXCEPTION 'FAIL: L) expected has_more TRUE when batch = eligible-1';
    END IF;

    -- Exact multiple → has_more FALSE (no extra empty invocation; §8 100→2 / 300→6)
    v_result := public.evaluate_occupancy_alerts(v_eligible, NULL, NULL);
    IF (v_result->>'has_more')::BOOLEAN IS TRUE THEN
      RAISE EXCEPTION 'FAIL: L) has_more TRUE at exact batch boundary (eligible=%)', v_eligible;
    END IF;
    IF (v_result->>'scanned')::INTEGER <> v_eligible THEN
      RAISE EXCEPTION 'FAIL: L) scanned % != eligible %', v_result->>'scanned', v_eligible;
    END IF;
  ELSE
    v_result := public.evaluate_occupancy_alerts(500, NULL, NULL);
    IF (v_result->>'has_more')::BOOLEAN IS NOT TRUE THEN
      RAISE EXCEPTION 'FAIL: L) expected has_more TRUE when eligible(%) > batch cap 500', v_eligible;
    END IF;
  END IF;
  RAISE NOTICE 'PASS: L) exact boundary has_more (eligible=%)', v_eligible;

  RAISE NOTICE 'PASS: F4-003 harness';
END;
$$;

ROLLBACK;
