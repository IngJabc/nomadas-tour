-- ============================================================
-- WKR-007 Fase 2 — trip.* RPC transactional verification
--
-- Prerequisites: migrations 049, 050, 053, 057 applied.
-- Non-destructive: every test runs inside one transaction and
-- the script always ends with ROLLBACK.
--
-- Verifies:
--   A) All 5 RPCs + emit_trip_event exist, SECURITY DEFINER,
--      search_path public, EXECUTE service_role only.
--   B) create_trip: trip + seats + trip_agencies + trip.created.v1.
--   C) create_trip duplicate (unique race) -> ERR_TRIP_DUPLICATE.
--   D) update_trip postpone -> trip.postponed.v1 + postponed_from.
--   E) update_trip non-postpone -> trip.updated.v1 + changed_fields.
--   F) update_trip shrink with busy seat -> ERR_SEATS_IN_USE.
--   G) set_trip_status cancelled -> seats released + trip.cancelled.v1.
--   H) set_trip_status completed before departure -> ERR_TRIP_NOT_DEPARTED.
--   I) complete_trip auto -> trip.auto_completed.v1 (source auto).
--   J) complete_trip manual -> trip.completed.v1.
--   K) archive_trip active -> ERR_TRIP_ACTIVE; on cancelled -> archived.
--   L) dedup discipline: ON CONFLICT DO NOTHING without conflict target.
-- ============================================================

BEGIN;

-- A) Function surface + security posture.
DO $$
DECLARE
  v_found_count INTEGER;
  v_row RECORD;
BEGIN
  SELECT COUNT(*) INTO v_found_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('emit_trip_event', 'create_trip', 'update_trip',
      'set_trip_status', 'complete_trip', 'archive_trip');

  IF v_found_count <> 6 THEN
    RAISE EXCEPTION 'FAIL: A) expected 6 functions, found %', v_found_count;
  END IF;

  FOR v_row IN
    SELECT p.proname, p.prosecdef, p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('emit_trip_event', 'create_trip', 'update_trip',
        'set_trip_status', 'complete_trip', 'archive_trip')
  LOOP
    IF NOT v_row.prosecdef THEN
      RAISE EXCEPTION 'FAIL: A) % is not SECURITY DEFINER', v_row.proname;
    END IF;
    IF NOT COALESCE(
      'search_path=public' = ANY(v_row.proconfig),
      FALSE
    ) THEN
      RAISE EXCEPTION 'FAIL: A) % missing SET search_path = public', v_row.proname;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: A) 6 trip RPC helpers exist, SECURITY DEFINER, search_path public';
END $$;

-- A2) Grants: service_role only (posture 037).
DO $$
DECLARE
  v_fn RECORD;
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('emit_trip_event', 'create_trip', 'update_trip',
        'set_trip_status', 'complete_trip', 'archive_trip')
  LOOP
    IF NOT has_function_privilege('service_role',
      v_fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: A2) service_role missing EXECUTE on %', v_fn.proname;
    END IF;
    IF has_function_privilege('anon',
      v_fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: A2) anon can EXECUTE %', v_fn.proname;
    END IF;
    IF has_function_privilege('authenticated',
      v_fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: A2) authenticated can EXECUTE %', v_fn.proname;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: A2) EXECUTE service_role only';
END $$;

-- B) create_trip happy path.
DO $$
DECLARE
  v_agency1 UUID := gen_random_uuid();
  v_agency2 UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_result JSONB;
  v_trip_id UUID;
  v_seat_count INTEGER;
  v_ta_count INTEGER;
  v_event public.outbox_events%ROWTYPE;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES
    (v_agency1, 'Fase2 Agency One', 'fase2one-' || LEFT(REPLACE(v_agency1::text, '-', ''), 16), NULL, 'active'),
    (v_agency2, 'Fase2 Agency Two', 'fase2two-' || LEFT(REPLACE(v_agency2::text, '-', ''), 16), NULL, 'active');

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'Fase2 Origin', 'Fase2 Destination', 'active');

  v_result := public.create_trip(
    v_route,
    clock_timestamp() + INTERVAL '3 days',
    'kia',
    ARRAY[v_agency1, v_agency2],
    NULL
  );

  v_trip_id := (v_result->>'id')::UUID;

  SELECT COUNT(*) INTO v_seat_count
  FROM public.seats WHERE trip_id = v_trip_id;
  IF v_seat_count <> 10 THEN
    RAISE EXCEPTION 'FAIL: B) expected 10 kia seats, found %', v_seat_count;
  END IF;

  SELECT COUNT(*) INTO v_ta_count
  FROM public.trip_agencies WHERE trip_id = v_trip_id;
  IF v_ta_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: B) expected 2 trip_agencies, found %', v_ta_count;
  END IF;

  SELECT * INTO STRICT v_event
  FROM public.outbox_events
  WHERE event_type = 'trip.created' AND aggregate_id = v_trip_id;

  IF v_event.event_version <> 1
    OR v_event.aggregate_type <> 'trip'
    OR v_event.tenant_id IS NOT NULL
    OR v_event.dedup_key <> 'trip.created:' || v_trip_id::text
    OR v_event.payload->>'trip_id' <> v_trip_id::text
    OR v_event.payload->>'vehicle_type' <> 'kia'
    OR v_event.payload->>'capacity' <> '10'
    OR jsonb_array_length(v_event.payload->'agency_ids') <> 2
  THEN
    RAISE EXCEPTION 'FAIL: B) trip.created envelope mismatch: %', v_event.payload;
  END IF;

  RAISE NOTICE 'PASS: B) create_trip persisted trip/seats/agencies + trip.created.v1';
END $$;

-- C) create_trip duplicate -> unique race protected.
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_departure TIMESTAMPTZ := clock_timestamp() + INTERVAL '4 days';
  v_err TEXT;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (v_agency, 'Fase2 Dup Agency', 'fase2dup-' || LEFT(REPLACE(v_agency::text, '-', ''), 16), NULL, 'active');

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'Fase2 Dup Origin', 'Fase2 Dup Destination', 'active');

  PERFORM public.create_trip(v_route, v_departure, 'kia', ARRAY[v_agency], NULL);

  BEGIN
    PERFORM public.create_trip(v_route, v_departure, 'kia', ARRAY[v_agency], NULL);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  IF v_err IS NULL OR v_err NOT LIKE 'ERR_TRIP_DUPLICATE%' THEN
    RAISE EXCEPTION 'FAIL: C) expected ERR_TRIP_DUPLICATE, got: %', v_err;
  END IF;

  RAISE NOTICE 'PASS: C) duplicate create_trip rejected atomically';
END $$;

-- D) update_trip postpone -> trip.postponed.v1 + postponed_from.
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_old TIMESTAMPTZ := clock_timestamp() + INTERVAL '5 days';
  v_new TIMESTAMPTZ := clock_timestamp() + INTERVAL '7 days';
  v_trip_id UUID;
  v_result JSONB;
  v_postponed_from TIMESTAMPTZ;
  v_event public.outbox_events%ROWTYPE;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (v_agency, 'Fase2 Postpone Agency', 'fase2post-' || LEFT(REPLACE(v_agency::text, '-', ''), 16), NULL, 'active');

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'Fase2 Post Origin', 'Fase2 Post Destination', 'active');

  v_trip_id := (public.create_trip(v_route, v_old, 'kia', ARRAY[v_agency], NULL)->>'id')::UUID;

  v_result := public.update_trip(
    v_trip_id, v_route, v_new, 'kia', ARRAY[v_agency], TRUE
  );

  IF (v_result->>'action') <> 'postponed' OR (v_result->>'event_type') <> 'trip.postponed' THEN
    RAISE EXCEPTION 'FAIL: D) expected action postponed, got %', v_result;
  END IF;

  SELECT postponed_from INTO v_postponed_from FROM public.trips WHERE id = v_trip_id;
  IF v_postponed_from IS NULL OR v_postponed_from <> v_old THEN
    RAISE EXCEPTION 'FAIL: D) postponed_from not set to old departure';
  END IF;

  SELECT * INTO STRICT v_event
  FROM public.outbox_events
  WHERE event_type = 'trip.postponed' AND aggregate_id = v_trip_id;

  IF v_event.tenant_id IS NOT NULL
    OR v_event.payload->>'previous_departure_time' IS NULL
    OR v_event.payload->>'departure_time' IS NULL
    OR v_event.dedup_key <> 'trip.postponed:' || v_trip_id::text
      || ':' || to_char(v_old AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      || ':' || to_char(v_new AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  THEN
    RAISE EXCEPTION 'FAIL: D) trip.postponed envelope mismatch: %', v_event.payload;
  END IF;

  RAISE NOTICE 'PASS: D) update_trip(p_postpone=true) -> postponed_from + trip.postponed.v1';
END $$;

-- E) update_trip non-postpone -> trip.updated.v1 + changed_fields.
DO $$
DECLARE
  v_agency1 UUID := gen_random_uuid();
  v_agency2 UUID := gen_random_uuid();
  v_route1 UUID := gen_random_uuid();
  v_route2 UUID := gen_random_uuid();
  v_departure TIMESTAMPTZ := clock_timestamp() + INTERVAL '6 days';
  v_trip_id UUID;
  v_result JSONB;
  v_event public.outbox_events%ROWTYPE;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES
    (v_agency1, 'Fase2 Update Agency One', 'fase2upd1-' || LEFT(REPLACE(v_agency1::text, '-', ''), 16), NULL, 'active'),
    (v_agency2, 'Fase2 Update Agency Two', 'fase2upd2-' || LEFT(REPLACE(v_agency2::text, '-', ''), 16), NULL, 'active');

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES
    (v_route1, 'Fase2 Upd Origin A', 'Fase2 Upd Dest A', 'active'),
    (v_route2, 'Fase2 Upd Origin B', 'Fase2 Upd Dest B', 'active');

  v_trip_id := (public.create_trip(v_route1, v_departure, 'kia', ARRAY[v_agency1], NULL)->>'id')::UUID;

  v_result := public.update_trip(
    v_trip_id, v_route2, v_departure, 'bus', ARRAY[v_agency1, v_agency2], FALSE
  );

  IF (v_result->>'action') <> 'updated' OR (v_result->>'event_type') <> 'trip.updated' THEN
    RAISE EXCEPTION 'FAIL: E) expected action updated, got %', v_result;
  END IF;

  SELECT * INTO STRICT v_event
  FROM public.outbox_events
  WHERE event_type = 'trip.updated' AND aggregate_id = v_trip_id;

  IF NOT (v_event.payload ? 'changed_fields')
    OR v_event.payload->'changed_fields'
      <> '["agency_ids","capacity","route_id","vehicle_type"]'::jsonb
    OR jsonb_array_length(v_event.payload->'agency_ids') <> 2
    OR v_event.dedup_key NOT LIKE 'trip.updated:' || v_trip_id::text || ':%'
  THEN
    RAISE EXCEPTION 'FAIL: E) trip.updated envelope mismatch: %', v_event.payload;
  END IF;

  RAISE NOTICE 'PASS: E) update_trip(non-postpone) -> trip.updated.v1 + changed_fields';
END $$;

-- F) update_trip shrink with busy excess seat -> ERR_SEATS_IN_USE.
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_departure TIMESTAMPTZ := clock_timestamp() + INTERVAL '8 days';
  v_trip_id UUID;
  v_err TEXT;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (v_agency, 'Fase2 Shrink Agency', 'fase2shr-' || LEFT(REPLACE(v_agency::text, '-', ''), 16), NULL, 'active');

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'Fase2 Shrink Origin', 'Fase2 Shrink Dest', 'active');

  v_trip_id := (public.create_trip(v_route, v_departure, 'bus', ARRAY[v_agency], NULL)->>'id')::UUID;

  UPDATE public.seats SET status = 'reserved'
  WHERE trip_id = v_trip_id AND seat_code = 'A20';

  BEGIN
    PERFORM public.update_trip(
      v_trip_id, v_route, v_departure, 'kia', ARRAY[v_agency], FALSE
    );
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  IF v_err IS NULL OR v_err NOT LIKE 'ERR_SEATS_IN_USE%' THEN
    RAISE EXCEPTION 'FAIL: F) expected ERR_SEATS_IN_USE, got: %', v_err;
  END IF;

  IF (SELECT vehicle_type FROM public.trips WHERE id = v_trip_id) <> 'bus'
    OR (SELECT capacity FROM public.trips WHERE id = v_trip_id) <> 31
    OR (SELECT COUNT(*) FROM public.seats WHERE trip_id = v_trip_id) <> 31
    OR (SELECT status FROM public.seats
        WHERE trip_id = v_trip_id AND seat_code = 'A20') <> 'reserved'
  THEN
    RAISE EXCEPTION 'FAIL: F) rejected shrink left partial trip/seat changes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.outbox_events
    WHERE event_type = 'trip.updated'
      AND aggregate_id = v_trip_id
  ) THEN
    RAISE EXCEPTION 'FAIL: F) rejected shrink emitted trip.updated';
  END IF;

  RAISE NOTICE 'PASS: F) shrink blocked when excess seat has activity';
END $$;

-- G) set_trip_status cancelled -> seats released + trip.cancelled.v1.
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_id UUID;
  v_seat_count INTEGER;
  v_event public.outbox_events%ROWTYPE;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (v_agency, 'Fase2 Cancel Agency', 'fase2cnl-' || LEFT(REPLACE(v_agency::text, '-', ''), 16), NULL, 'active');

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'Fase2 Cancel Origin', 'Fase2 Cancel Dest', 'active');

  v_trip_id := (public.create_trip(v_route, clock_timestamp() + INTERVAL '9 days', 'kia', ARRAY[v_agency], NULL)->>'id')::UUID;

  UPDATE public.seats SET status = 'locked', locked_by = NULL, locked_at = NOW()
  WHERE trip_id = v_trip_id AND seat_code IN ('A2', 'A3');

  PERFORM public.set_trip_status(v_trip_id, 'cancelled');

  SELECT COUNT(*) INTO v_seat_count
  FROM public.seats
  WHERE trip_id = v_trip_id AND status <> 'available';
  IF v_seat_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: G) expected all seats released, % non-available', v_seat_count;
  END IF;

  SELECT * INTO STRICT v_event
  FROM public.outbox_events
  WHERE event_type = 'trip.cancelled' AND aggregate_id = v_trip_id;

  IF v_event.payload->>'status' <> 'cancelled'
    OR v_event.dedup_key <> 'trip.cancelled:' || v_trip_id::text
    OR v_event.tenant_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'FAIL: G) trip.cancelled envelope mismatch: %', v_event.payload;
  END IF;

  RAISE NOTICE 'PASS: G) set_trip_status(cancelled) -> seats released + trip.cancelled.v1';
END $$;

-- H) set_trip_status completed before departure -> ERR_TRIP_NOT_DEPARTED.
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_id UUID;
  v_err TEXT;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (v_agency, 'Fase2 Early Agency', 'fase2early-' || LEFT(REPLACE(v_agency::text, '-', ''), 16), NULL, 'active');

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'Fase2 Early Origin', 'Fase2 Early Dest', 'active');

  v_trip_id := (public.create_trip(v_route, clock_timestamp() + INTERVAL '10 days', 'kia', ARRAY[v_agency], NULL)->>'id')::UUID;

  BEGIN
    PERFORM public.set_trip_status(v_trip_id, 'completed');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  IF v_err IS NULL OR v_err NOT LIKE 'ERR_TRIP_NOT_DEPARTED%' THEN
    RAISE EXCEPTION 'FAIL: H) expected ERR_TRIP_NOT_DEPARTED, got: %', v_err;
  END IF;

  RAISE NOTICE 'PASS: H) early completion rejected';
END $$;

-- I) complete_trip auto -> trip.auto_completed.v1 (source auto).
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_id UUID;
  v_event public.outbox_events%ROWTYPE;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (v_agency, 'Fase2 Auto Agency', 'fase2auto-' || LEFT(REPLACE(v_agency::text, '-', ''), 16), NULL, 'active');

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'Fase2 Auto Origin', 'Fase2 Auto Dest', 'active');

  v_trip_id := (public.create_trip(v_route, clock_timestamp() - INTERVAL '4 days', 'kia', ARRAY[v_agency], NULL)->>'id')::UUID;

  PERFORM public.complete_trip(v_trip_id, 'auto');

  SELECT * INTO STRICT v_event
  FROM public.outbox_events
  WHERE event_type = 'trip.auto_completed' AND aggregate_id = v_trip_id;

  IF v_event.payload->>'source' <> 'auto'
    OR v_event.payload->>'status' <> 'completed'
    OR v_event.dedup_key NOT LIKE 'trip.auto_completed:' || v_trip_id::text || ':%'
  THEN
    RAISE EXCEPTION 'FAIL: I) trip.auto_completed envelope mismatch: %', v_event.payload;
  END IF;

  RAISE NOTICE 'PASS: I) complete_trip(auto) -> trip.auto_completed.v1';
END $$;

-- J) complete_trip manual -> trip.completed.v1.
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip_id UUID;
  v_event public.outbox_events%ROWTYPE;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (v_agency, 'Fase2 Manual Agency', 'fase2man-' || LEFT(REPLACE(v_agency::text, '-', ''), 16), NULL, 'active');

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'Fase2 Manual Origin', 'Fase2 Manual Dest', 'active');

  v_trip_id := (public.create_trip(v_route, clock_timestamp() - INTERVAL '1 hour', 'kia', ARRAY[v_agency], NULL)->>'id')::UUID;

  PERFORM public.complete_trip(v_trip_id, 'manual');

  SELECT * INTO STRICT v_event
  FROM public.outbox_events
  WHERE event_type = 'trip.completed' AND aggregate_id = v_trip_id;

  IF v_event.payload->>'status' <> 'completed'
    OR v_event.payload ? 'source'
    OR v_event.dedup_key <> 'trip.completed:' || v_trip_id::text
  THEN
    RAISE EXCEPTION 'FAIL: J) trip.completed envelope mismatch: %', v_event.payload;
  END IF;

  RAISE NOTICE 'PASS: J) complete_trip(manual) -> trip.completed.v1';
END $$;

-- K) archive_trip guards + happy path.
DO $$
DECLARE
  v_agency UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_active_trip UUID;
  v_cancelled_trip UUID;
  v_err TEXT;
  v_event public.outbox_events%ROWTYPE;
  v_status TEXT;
BEGIN
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES (v_agency, 'Fase2 Archive Agency', 'fase2arc-' || LEFT(REPLACE(v_agency::text, '-', ''), 16), NULL, 'active');

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'Fase2 Archive Origin', 'Fase2 Archive Dest', 'active');

  v_active_trip := (public.create_trip(v_route, clock_timestamp() + INTERVAL '11 days', 'kia', ARRAY[v_agency], NULL)->>'id')::UUID;

  BEGIN
    PERFORM public.archive_trip(v_active_trip);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;

  IF v_err IS NULL OR v_err NOT LIKE 'ERR_TRIP_ACTIVE%' THEN
    RAISE EXCEPTION 'FAIL: K) expected ERR_TRIP_ACTIVE on active trip, got: %', v_err;
  END IF;

  v_cancelled_trip := (public.create_trip(v_route, clock_timestamp() + INTERVAL '12 days', 'kia', ARRAY[v_agency], NULL)->>'id')::UUID;
  PERFORM public.set_trip_status(v_cancelled_trip, 'cancelled');

  PERFORM public.archive_trip(v_cancelled_trip);

  SELECT status INTO v_status FROM public.trips WHERE id = v_cancelled_trip;
  IF v_status <> 'archived' THEN
    RAISE EXCEPTION 'FAIL: K) expected archived status, got %', v_status;
  END IF;

  SELECT * INTO STRICT v_event
  FROM public.outbox_events
  WHERE event_type = 'trip.archived' AND aggregate_id = v_cancelled_trip;

  IF v_event.payload->>'status' <> 'archived'
    OR v_event.dedup_key <> 'trip.archived:' || v_cancelled_trip::text
    OR v_event.tenant_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'FAIL: K) trip.archived envelope mismatch: %', v_event.payload;
  END IF;

  RAISE NOTICE 'PASS: K) archive_trip guards + trip.archived.v1';
END $$;

-- L) Dedup discipline: the outbox INSERT (inside emit_trip_event) must use
-- ON CONFLICT DO NOTHING without a conflict_target. The no-target rule
-- (§9.4) applies only to outbox_events.dedup_key / notifications inserts,
-- NOT to the whole migration. The seats inventory upsert in update_trip
-- legitimately keeps ON CONFLICT (trip_id, seat_code) DO NOTHING (L2).
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'emit_trip_event';

  IF v_def IS NULL OR v_def = '' THEN
    RAISE EXCEPTION 'FAIL: L) emit_trip_event not found';
  END IF;

  IF v_def NOT ILIKE '%INSERT INTO public.outbox_events%' THEN
    RAISE EXCEPTION 'FAIL: L) emit_trip_event missing outbox insert';
  END IF;

  IF v_def NOT ILIKE '%ON CONFLICT DO NOTHING%' THEN
    RAISE EXCEPTION 'FAIL: L) emit_trip_event missing ON CONFLICT DO NOTHING';
  END IF;

  IF v_def ~* 'ON\s+CONFLICT\s*(\(|ON\s+CONSTRAINT)' THEN
    RAISE EXCEPTION 'FAIL: L) emit_trip_event outbox insert uses a conflict_target';
  END IF;

  RAISE NOTICE 'PASS: L) dedup ON CONFLICT DO NOTHING (no conflict target)';
END $$;

-- L2) Seats inventory upsert keeps its (trip_id, seat_code) conflict target.
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'update_trip';

  IF v_def IS NULL OR v_def = '' THEN
    RAISE EXCEPTION 'FAIL: L2) update_trip not found';
  END IF;

  IF v_def !~* 'ON\s+CONFLICT\s*\(\s*trip_id\s*,\s*seat_code\s*\)\s*DO\s+NOTHING' THEN
    RAISE EXCEPTION 'FAIL: L2) update_trip missing seats upsert (trip_id, seat_code)';
  END IF;

  RAISE NOTICE 'PASS: L2) seats upsert keeps ON CONFLICT (trip_id, seat_code) DO NOTHING';
END $$;

ROLLBACK;
