-- ============================================================
-- F4-004 verification harness (BEGIN / ROLLBACK — non-destructive)
-- Requires migrations 063 + 064 applied. Run manually in Supabase SQL editor.
--
-- Coverage:
--   A) RPC posture (4-arg DEFINER, search_path=public)
--   B) EXECUTE grants (service_role only)
--   C) p_urgency_enabled=FALSE → F4-003 intact; candidates counted, no emit
--   D) flag TRUE + alerted + in-window → emit + payload contract (no PII)
--   E) second tick → already_escalated, no duplicate
--   F) same-tick sequencing with a dedicated FRESH trip (flag TRUE):
--        tick 1: NORMAL→ALERTED enter → alert.due only, NO urgency this tick
--        tick 2: still alerted + in T-24h → urgency (subsequent tick)
--        tick 3: no second urgency for the same cycle
--   G) postponement → NEW urgency cycle (new dedup_key, payload departure = D2)
--   H) outside T-24h → no urgency
--   J) cleanup inherited (cancelled state removed)
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_is_definer BOOLEAN;
  v_search_path TEXT;
  v_has_execute BOOLEAN;
  v_nargs INTEGER;
  v_route UUID := 'f4004000-0000-4000-8000-000000000001';
  v_trip_in UUID := 'f4004000-0000-4000-8000-000000000011';
  v_trip_out UUID := 'f4004000-0000-4000-8000-000000000012';
  v_trip_enter UUID := 'f4004000-0000-4000-8000-000000000013';
  v_trip_post UUID := 'f4004000-0000-4000-8000-000000000014';
  -- Dedicated fresh trip for the same-tick sequencing scenario (F).
  -- Never entered the alerted state before that scenario.
  v_trip_seq UUID := 'f4004000-0000-4000-8000-000000000015';
  v_result JSONB;
  v_result2 JSONB;
  v_events INTEGER;
  v_payload JSONB;
  v_dep TIMESTAMPTZ;
  v_old_dep TIMESTAMPTZ;
  v_enter_ts TIMESTAMPTZ;
  v_urgency_ts TIMESTAMPTZ;
  v_old_dep_payload TEXT;
  v_old_dedup TEXT;
  v_new_dep_payload TEXT;
  v_new_dedup TEXT;
BEGIN
  -- A) RPC posture: 4-arg signature, DEFINER, search_path=public
  SELECT p.prosecdef, p.pronargs INTO v_is_definer, v_nargs
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'evaluate_occupancy_alerts'
    AND pg_get_function_identity_arguments(p.oid)
      = 'integer, timestamp with time zone, uuid, boolean';

  IF v_is_definer IS NOT TRUE OR v_nargs IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'FAIL: A) 4-arg evaluate_occupancy_alerts DEFINER missing';
  END IF;

  SELECT array_to_string(p.proconfig, ',') INTO v_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'evaluate_occupancy_alerts'
    AND pg_get_function_identity_arguments(p.oid)
      = 'integer, timestamp with time zone, uuid, boolean';

  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'FAIL: A) search_path is not public: %', v_search_path;
  END IF;
  RAISE NOTICE 'PASS: A) evaluate_occupancy_alerts 4-arg DEFINER search_path=public';

  -- B) grants: service_role only on 4-arg
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

  INSERT INTO public.routes (id, origin, destination)
  VALUES (v_route, 'F4-004-Origin', 'F4-004-Dest')
  ON CONFLICT (id) DO NOTHING;

  -- Trip inside T-24h (pre-alerted near_full)
  INSERT INTO public.trips (id, route_id, departure_time, capacity, vehicle_type, status)
  VALUES
    (v_trip_in, v_route, NOW() + INTERVAL '6 hours', 10, 'kia', 'active'),
    (v_trip_out, v_route, NOW() + INTERVAL '48 hours', 10, 'kia', 'active'),
    (v_trip_enter, v_route, NOW() + INTERVAL '3 hours', 10, 'kia', 'active'),
    (v_trip_post, v_route, NOW() + INTERVAL '5 hours', 10, 'kia', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.seats (trip_id, seat_code, status)
  SELECT v_trip_in, 'A' || g, CASE WHEN g <= 9 THEN 'reserved' ELSE 'available' END
  FROM generate_series(1, 10) g;
  INSERT INTO public.seats (trip_id, seat_code, status)
  SELECT v_trip_out, 'A' || g, CASE WHEN g <= 9 THEN 'reserved' ELSE 'available' END
  FROM generate_series(1, 10) g;
  -- enter trip: underbooked seats, NO prior state row
  INSERT INTO public.seats (trip_id, seat_code, status)
  SELECT v_trip_enter, 'A' || g, CASE WHEN g <= 2 THEN 'reserved' ELSE 'available' END
  FROM generate_series(1, 10) g;
  INSERT INTO public.seats (trip_id, seat_code, status)
  SELECT v_trip_post, 'A' || g, CASE WHEN g <= 9 THEN 'reserved' ELSE 'available' END
  FROM generate_series(1, 10) g;

  INSERT INTO public.trip_occupancy_alert_state (
    trip_id, alert_type, state, occupancy_pct
  ) VALUES
    (v_trip_in, 'near_full', 'near_full_alerted', 90),
    (v_trip_out, 'near_full', 'near_full_alerted', 90),
    (v_trip_post, 'near_full', 'near_full_alerted', 90);

  -- C) p_urgency_enabled=FALSE does not emit urgency (F4-003 intact)
  v_result := public.evaluate_occupancy_alerts(50, NULL, NULL, FALSE);
  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_urgency.due'
    AND aggregate_id IN (v_trip_in, v_trip_out, v_trip_enter, v_trip_post);
  IF v_events <> 0 THEN
    RAISE EXCEPTION 'FAIL: C) urgency emitted with flag false, got %', v_events;
  END IF;
  IF (v_result->>'urgency_matches')::INTEGER < 1 THEN
    RAISE EXCEPTION 'FAIL: C) expected urgency_matches while soaking';
  END IF;
  IF (v_result->>'urgency_emitted')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'FAIL: C) urgency_emitted should be 0 when disabled';
  END IF;
  RAISE NOTICE 'PASS: C) urgency off — matches counted, no emit';

  -- D) flag on + alerted + in window → 1 event, payload contract
  v_result := public.evaluate_occupancy_alerts(50, NULL, NULL, TRUE);
  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_urgency.due'
    AND aggregate_id = v_trip_in;
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'FAIL: D) expected 1 urgency for in-window trip, got %', v_events;
  END IF;

  SELECT payload INTO v_payload
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_urgency.due'
    AND aggregate_id = v_trip_in
  LIMIT 1;
  IF v_payload->>'urgency_window' IS DISTINCT FROM 't24' THEN
    RAISE EXCEPTION 'FAIL: D) urgency_window missing/wrong';
  END IF;
  -- F4-004 forbidden fields: agency_ids, email, booker_name, transition.
  IF v_payload ? 'agency_ids'
    OR v_payload ? 'email'
    OR v_payload ? 'booker_name'
    OR v_payload ? 'transition'
  THEN
    RAISE EXCEPTION 'FAIL: D) payload contains forbidden keys';
  END IF;
  IF (v_result->>'urgency_emitted')::INTEGER < 1 THEN
    RAISE EXCEPTION 'FAIL: D) urgency_emitted not incremented';
  END IF;
  RAISE NOTICE 'PASS: D) urgency emit + payload';

  -- E) second tick → already_escalated, no duplicate
  v_result2 := public.evaluate_occupancy_alerts(50, NULL, NULL, TRUE);
  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_urgency.due'
    AND aggregate_id = v_trip_in;
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'FAIL: E) duplicate urgency event, got %', v_events;
  END IF;
  IF (v_result2->>'already_escalated')::INTEGER < 1 THEN
    RAISE EXCEPTION 'FAIL: E) already_escalated not incremented';
  END IF;
  RAISE NOTICE 'PASS: E) dedup / already_escalated';

  -- F) same-tick sequencing with a dedicated FRESH trip.
  -- v_trip_seq has NO state row until tick 1: it is the trip that enters the
  -- alerted state DURING this scenario (NORMAL → underbooked, 2/10 = 20%).
  -- tick 1 (flag TRUE): enter only — F4-004 urgency must NOT fire this tick.
  -- tick 2 (flag TRUE): still alerted + in T-24h → urgency fires now.
  -- tick 3 (flag TRUE): no second urgency (same cycle).
  INSERT INTO public.trips (id, route_id, departure_time, capacity, vehicle_type, status)
  VALUES (v_trip_seq, v_route, NOW() + INTERVAL '3 hours', 10, 'kia', 'active')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.seats (trip_id, seat_code, status)
  SELECT v_trip_seq, 'A' || g, CASE WHEN g <= 2 THEN 'reserved' ELSE 'available' END
  FROM generate_series(1, 10) g;

  -- Tick 1 — fresh NORMAL trip enters this tick with flag TRUE.
  v_result := public.evaluate_occupancy_alerts(50, NULL, NULL, TRUE);
  IF NOT EXISTS (
    SELECT 1 FROM public.trip_occupancy_alert_state WHERE trip_id = v_trip_seq
  ) THEN
    RAISE EXCEPTION 'FAIL: F) tick 1 — expected NORMAL→ALERTED state';
  END IF;
  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_alert.due'
    AND aggregate_id = v_trip_seq;
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'FAIL: F) tick 1 — expected exactly 1 alert.due, got %', v_events;
  END IF;
  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_urgency.due'
    AND aggregate_id = v_trip_seq;
  IF v_events <> 0 THEN
    RAISE EXCEPTION 'FAIL: F) tick 1 — urgency emitted on fresh enter tick, got %', v_events;
  END IF;
  SELECT MAX(created_at) INTO v_enter_ts
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_alert.due'
    AND aggregate_id = v_trip_seq;
  RAISE NOTICE 'PASS: F) tick 1 — enter only, no urgency same tick';

  -- Tick 2 — still alerted + in T-24h → urgency on a SUBSEQUENT tick.
  v_result := public.evaluate_occupancy_alerts(50, NULL, NULL, TRUE);
  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_urgency.due'
    AND aggregate_id = v_trip_seq;
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'FAIL: F) tick 2 — expected exactly 1 urgency, got %', v_events;
  END IF;
  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_alert.due'
    AND aggregate_id = v_trip_seq;
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'FAIL: F) tick 2 — alert.due should stay exactly 1';
  END IF;
  SELECT payload, created_at INTO v_payload, v_urgency_ts
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_urgency.due'
    AND aggregate_id = v_trip_seq
  LIMIT 1;
  IF v_payload->>'trip_id' IS DISTINCT FROM v_trip_seq::TEXT THEN
    RAISE EXCEPTION 'FAIL: F) tick 2 — urgency belongs to wrong trip';
  END IF;
  IF v_payload->>'urgency_window' IS DISTINCT FROM 't24' THEN
    RAISE EXCEPTION 'FAIL: F) tick 2 — urgency_window missing/wrong';
  END IF;
  IF v_payload ? 'agency_ids'
    OR v_payload ? 'email'
    OR v_payload ? 'booker_name'
    OR v_payload ? 'transition'
  THEN
    RAISE EXCEPTION 'FAIL: F) tick 2 — forbidden keys in payload';
  END IF;
  -- created_at uses now() = transaction_timestamp(): inside this BEGIN/ROLLBACK
  -- harness every outbox row shares the same value, so a strict `>` cannot
  -- hold. The authoritative ordering proof is the per-tick isolation above
  -- (0 urgency right after tick 1, 1 after tick 2). This guard only rejects
  -- an urgency that appears BEFORE the enter event.
  IF v_urgency_ts < v_enter_ts THEN
    RAISE EXCEPTION 'FAIL: F) tick 2 — urgency created_at before enter event';
  END IF;
  RAISE NOTICE 'PASS: F) tick 2 — urgency emitted on subsequent tick';

  -- Tick 3 — no second urgency for the same cycle.
  v_result := public.evaluate_occupancy_alerts(50, NULL, NULL, TRUE);
  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_urgency.due'
    AND aggregate_id = v_trip_seq;
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'FAIL: F) tick 3 — duplicate urgency, got %', v_events;
  END IF;
  IF (v_result->>'already_escalated')::INTEGER < 1 THEN
    RAISE EXCEPTION 'FAIL: F) tick 3 — already_escalated not incremented';
  END IF;
  RAISE NOTICE 'PASS: F) tick 3 — no duplicate urgency';

  -- G) postponement → NEW urgency cycle for the new departure (D2).
  -- D1 urgency was emitted in tick D with the original departure; a new
  -- departure must produce a NEW event with a different dedup_key whose
  -- payload departure_time equals D2 (not a re-count of the D1 event).
  SELECT departure_time INTO v_old_dep
  FROM public.trips
  WHERE id = v_trip_post;
  SELECT payload->>'departure_time', dedup_key
  INTO v_old_dep_payload, v_old_dedup
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_urgency.due'
    AND aggregate_id = v_trip_post
    AND (payload->>'departure_time')::timestamptz = v_old_dep;
  IF v_old_dep_payload IS NULL THEN
    RAISE EXCEPTION 'FAIL: G) D1 urgency event missing';
  END IF;

  v_dep := NOW() + INTERVAL '4 hours';
  IF v_dep = v_old_dep THEN
    RAISE EXCEPTION 'FAIL: G) D2 equals D1 (invalid test setup)';
  END IF;
  UPDATE public.trips SET departure_time = v_dep WHERE id = v_trip_post;

  v_result := public.evaluate_occupancy_alerts(50, NULL, NULL, TRUE);

  -- Exactly two events: the old D1 cycle and the new D2 cycle.
  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_urgency.due'
    AND aggregate_id = v_trip_post;
  IF v_events <> 2 THEN
    RAISE EXCEPTION 'FAIL: G) expected exactly 2 urgency events (D1+D2), got %', v_events;
  END IF;

  SELECT payload->>'departure_time', dedup_key, payload
  INTO v_new_dep_payload, v_new_dedup, v_payload
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_urgency.due'
    AND aggregate_id = v_trip_post
    AND (payload->>'departure_time')::timestamptz = v_dep;
  IF v_new_dep_payload IS NULL THEN
    RAISE EXCEPTION 'FAIL: G) D2 urgency event missing';
  END IF;
  IF v_new_dedup = v_old_dedup THEN
    RAISE EXCEPTION 'FAIL: G) dedup_key unchanged after postponement';
  END IF;
  IF (v_new_dep_payload::timestamptz) IS DISTINCT FROM v_dep THEN
    RAISE EXCEPTION 'FAIL: G) new urgency departure_time != D2';
  END IF;
  IF v_payload ? 'agency_ids'
    OR v_payload ? 'email'
    OR v_payload ? 'booker_name'
    OR v_payload ? 'transition'
  THEN
    RAISE EXCEPTION 'FAIL: G) forbidden keys in D2 payload';
  END IF;
  RAISE NOTICE 'PASS: G) postponement new cycle (dedup + departure D2)';

  -- H) outside window → no urgency
  SELECT COUNT(*) INTO v_events
  FROM public.outbox_events
  WHERE event_type = 'trip.occupancy_urgency.due'
    AND aggregate_id = v_trip_out;
  IF v_events <> 0 THEN
    RAISE EXCEPTION 'FAIL: H) urgency outside T-24h';
  END IF;
  RAISE NOTICE 'PASS: H) outside window no urgency';

  -- I) without state → no urgency
  -- covered by enter/out cases above (NORMAL enter tick and out-of-window trip).
  RAISE NOTICE 'PASS: I) no-state covered via enter/out cases';

  -- J) cleanup inherited — cancelled trip state cleaned without urgency
  UPDATE public.trips SET status = 'cancelled' WHERE id = v_trip_in;
  v_result := public.evaluate_occupancy_alerts(50, NULL, NULL, TRUE);
  IF EXISTS (
    SELECT 1 FROM public.trip_occupancy_alert_state WHERE trip_id = v_trip_in
  ) THEN
    RAISE EXCEPTION 'FAIL: J) cancelled state not cleaned';
  END IF;
  IF (v_result->>'cleaned_up')::INTEGER < 1 THEN
    RAISE EXCEPTION 'FAIL: J) cleaned_up not incremented';
  END IF;
  RAISE NOTICE 'PASS: J) cleanup cancelled state';

  RAISE NOTICE 'PASS: F4-004 harness';
END;
$$;

ROLLBACK;
