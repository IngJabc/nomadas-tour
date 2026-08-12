-- ============================================================
-- WKR-009 — purge_completed_outbox_events behavioral verification
--
-- Prerequisites: migrations through 060 applied.
-- Non-destructive: one outer transaction; script always ends with ROLLBACK.
--
-- Verifies:
--   A) completed ancient (40d) → deleted
--   B) completed recent (1d) → retained
--   C) processed_at NULL: updated_at 40d deleted; recent retained
--   D) failed ancient → retained
--   E) pending ancient → retained
--   F) processing ancient → retained
--   G) batch limit (p_batch=2 deletes exactly 2 of N eligible)
--   H) second call → deleted = 0 (idempotent)
--   I) sequential batch=1 on 2 candidates → at most 1 each call
--   J) SECURITY DEFINER / grants / completed-only predicate
-- ============================================================

BEGIN;

-- Helper: insert a synthetic outbox row with controlled timestamps/status.
-- (Defined as nested DOs below; no persistent helper function.)

-- J) Security surface first (no data dependency).
DO $$
DECLARE
  v_oid OID;
  v_def TEXT;
  v_prosecdef BOOLEAN;
  v_config TEXT[];
BEGIN
  SELECT p.oid, p.prosecdef, p.proconfig
  INTO v_oid, v_prosecdef, v_config
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'purge_completed_outbox_events'
    AND p.pronargs = 2
    AND p.proargtypes[0] = 'int4'::regtype
    AND p.proargtypes[1] = 'int4'::regtype;

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'FAIL: J) purge_completed_outbox_events(integer,integer) not found';
  END IF;

  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: J) expected SECURITY DEFINER';
  END IF;

  IF v_config IS NULL OR NOT (
    'search_path=public' = ANY (v_config)
    OR 'search_path="public"' = ANY (v_config)
  ) THEN
    RAISE EXCEPTION 'FAIL: J) expected SET search_path = public, got %', v_config;
  END IF;

  IF has_function_privilege('service_role', v_oid, 'EXECUTE') IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: J) service_role must have EXECUTE';
  END IF;

  IF has_function_privilege('public', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: J) PUBLIC must not have EXECUTE';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: J) anon must not have EXECUTE';
  END IF;

  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: J) authenticated must not have EXECUTE';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;

  IF v_def !~ $re$status = 'completed'$re$ THEN
    RAISE EXCEPTION 'FAIL: J) expected hardcoded status = ''completed''';
  END IF;

  IF v_def ~* $re$p_status$re$ THEN
    RAISE EXCEPTION 'FAIL: J) status must not be parameterized (p_status)';
  END IF;

  IF v_def !~* $re$FOR UPDATE SKIP LOCKED$re$ THEN
    RAISE EXCEPTION 'FAIL: J) expected FOR UPDATE SKIP LOCKED';
  END IF;

  IF v_def !~* $re$COALESCE\(e\.processed_at, e\.updated_at\)$re$ THEN
    RAISE EXCEPTION 'FAIL: J) expected COALESCE(processed_at, updated_at)';
  END IF;

  RAISE NOTICE 'PASS: J) security surface DEFINER / grants / completed-only';
END $$;

-- A) completed ancient → deleted
DO $$
DECLARE
  v_id UUID := gen_random_uuid();
  v_agg UUID := gen_random_uuid();
  v_result JSONB;
  v_exists BOOLEAN;
BEGIN
  INSERT INTO public.outbox_events (
    id, event_type, event_version, aggregate_type, aggregate_id,
    payload, status, processed_at, created_at, updated_at
  ) VALUES (
    v_id, 'wkr009.test', 1, 'test', v_agg,
    '{}'::jsonb, 'completed',
    NOW() - INTERVAL '40 days',
    NOW() - INTERVAL '40 days',
    NOW() - INTERVAL '40 days'
  );

  v_result := public.purge_completed_outbox_events(1000, 30);

  IF (v_result->>'deleted')::INTEGER < 1 THEN
    RAISE EXCEPTION 'FAIL: A) expected deleted >= 1, got %', v_result;
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.outbox_events WHERE id = v_id) INTO v_exists;
  IF v_exists THEN
    RAISE EXCEPTION 'FAIL: A) ancient completed row still present';
  END IF;

  RAISE NOTICE 'PASS: A) completed ancient deleted (rpc=%)', v_result;
END $$;

-- B) completed recent → retained
DO $$
DECLARE
  v_id UUID := gen_random_uuid();
  v_agg UUID := gen_random_uuid();
  v_result JSONB;
  v_exists BOOLEAN;
BEGIN
  INSERT INTO public.outbox_events (
    id, event_type, event_version, aggregate_type, aggregate_id,
    payload, status, processed_at, created_at, updated_at
  ) VALUES (
    v_id, 'wkr009.test', 1, 'test', v_agg,
    '{}'::jsonb, 'completed',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 day'
  );

  v_result := public.purge_completed_outbox_events(1000, 30);

  SELECT EXISTS(SELECT 1 FROM public.outbox_events WHERE id = v_id) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'FAIL: B) recent completed row was deleted (rpc=%)', v_result;
  END IF;

  RAISE NOTICE 'PASS: B) completed recent retained';
END $$;

-- C) processed_at NULL — updated_at fallback
DO $$
DECLARE
  v_old UUID := gen_random_uuid();
  v_new UUID := gen_random_uuid();
  v_agg UUID := gen_random_uuid();
  v_result JSONB;
  v_old_exists BOOLEAN;
  v_new_exists BOOLEAN;
BEGIN
  INSERT INTO public.outbox_events (
    id, event_type, event_version, aggregate_type, aggregate_id,
    payload, status, processed_at, created_at, updated_at
  ) VALUES
  (
    v_old, 'wkr009.test', 1, 'test', v_agg,
    '{}'::jsonb, 'completed', NULL,
    NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'
  ),
  (
    v_new, 'wkr009.test', 1, 'test', v_agg,
    '{}'::jsonb, 'completed', NULL,
    NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'
  );

  v_result := public.purge_completed_outbox_events(1000, 30);

  SELECT EXISTS(SELECT 1 FROM public.outbox_events WHERE id = v_old) INTO v_old_exists;
  SELECT EXISTS(SELECT 1 FROM public.outbox_events WHERE id = v_new) INTO v_new_exists;

  IF v_old_exists THEN
    RAISE EXCEPTION 'FAIL: C) NULL processed_at + ancient updated_at should delete';
  END IF;
  IF NOT v_new_exists THEN
    RAISE EXCEPTION 'FAIL: C) NULL processed_at + recent updated_at should retain (rpc=%)', v_result;
  END IF;

  RAISE NOTICE 'PASS: C) processed_at NULL uses updated_at';
END $$;

-- D/E/F) non-completed statuses retained even if ancient
DO $$
DECLARE
  v_failed UUID := gen_random_uuid();
  v_pending UUID := gen_random_uuid();
  v_processing UUID := gen_random_uuid();
  v_agg UUID := gen_random_uuid();
  v_result JSONB;
  v_count INTEGER;
BEGIN
  INSERT INTO public.outbox_events (
    id, event_type, event_version, aggregate_type, aggregate_id,
    payload, status, processed_at, created_at, updated_at
  ) VALUES
  (
    v_failed, 'wkr009.test', 1, 'test', v_agg,
    '{}'::jsonb, 'failed',
    NOW() - INTERVAL '40 days',
    NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'
  ),
  (
    v_pending, 'wkr009.test', 1, 'test', v_agg,
    '{}'::jsonb, 'pending',
    NULL,
    NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'
  ),
  (
    v_processing, 'wkr009.test', 1, 'test', v_agg,
    '{}'::jsonb, 'processing',
    NULL,
    NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'
  );

  v_result := public.purge_completed_outbox_events(1000, 30);

  SELECT COUNT(*) INTO v_count
  FROM public.outbox_events
  WHERE id IN (v_failed, v_pending, v_processing);

  IF v_count <> 3 THEN
    RAISE EXCEPTION 'FAIL: D/E/F) expected 3 non-completed rows retained, got % (rpc=%)', v_count, v_result;
  END IF;

  RAISE NOTICE 'PASS: D) failed ancient retained';
  RAISE NOTICE 'PASS: E) pending ancient retained';
  RAISE NOTICE 'PASS: F) processing ancient retained';
END $$;

-- G) batch limit + H) second call idempotent
DO $$
DECLARE
  v_ids UUID[] := ARRAY[]::UUID[];
  v_id UUID;
  v_agg UUID := gen_random_uuid();
  v_i INTEGER;
  v_result JSONB;
  v_remaining INTEGER;
BEGIN
  FOR v_i IN 1..5 LOOP
    v_id := gen_random_uuid();
    v_ids := array_append(v_ids, v_id);
    INSERT INTO public.outbox_events (
      id, event_type, event_version, aggregate_type, aggregate_id,
      payload, status, processed_at, created_at, updated_at
    ) VALUES (
      v_id, 'wkr009.batch', 1, 'test', v_agg,
      '{}'::jsonb, 'completed',
      NOW() - INTERVAL '40 days' - (v_i * INTERVAL '1 hour'),
      NOW() - INTERVAL '40 days',
      NOW() - INTERVAL '40 days'
    );
  END LOOP;

  v_result := public.purge_completed_outbox_events(2, 30);

  IF (v_result->>'batch')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'FAIL: G) expected batch=2, got %', v_result;
  END IF;

  IF (v_result->>'deleted')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'FAIL: G) expected deleted=2, got %', v_result;
  END IF;

  SELECT COUNT(*) INTO v_remaining
  FROM public.outbox_events
  WHERE id = ANY (v_ids);

  IF v_remaining <> 3 THEN
    RAISE EXCEPTION 'FAIL: G) expected 3 of 5 remaining, got %', v_remaining;
  END IF;

  RAISE NOTICE 'PASS: G) p_batch=2 deleted exactly 2';

  -- Drain remaining eligible from this set
  PERFORM public.purge_completed_outbox_events(1000, 30);

  SELECT COUNT(*) INTO v_remaining
  FROM public.outbox_events
  WHERE id = ANY (v_ids);

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'FAIL: H setup) expected all batch candidates deleted before idle call';
  END IF;

  v_result := public.purge_completed_outbox_events(1000, 30);

  IF (v_result->>'deleted')::INTEGER <> 0 THEN
    -- May delete unrelated leftovers from earlier cases in same txn if any remain;
    -- ensure none of our G ids remain and deleted for a fresh no-op is 0 after drain.
    RAISE EXCEPTION 'FAIL: H) expected deleted=0 after drain, got %', v_result;
  END IF;

  RAISE NOTICE 'PASS: H) second call deleted=0 (idempotent)';
END $$;

-- I) sequential batch=1 on 2 candidates
DO $$
DECLARE
  v_a UUID := gen_random_uuid();
  v_b UUID := gen_random_uuid();
  v_agg UUID := gen_random_uuid();
  v_r1 JSONB;
  v_r2 JSONB;
  v_left INTEGER;
BEGIN
  INSERT INTO public.outbox_events (
    id, event_type, event_version, aggregate_type, aggregate_id,
    payload, status, processed_at, created_at, updated_at
  ) VALUES
  (
    v_a, 'wkr009.seq', 1, 'test', v_agg,
    '{}'::jsonb, 'completed',
    NOW() - INTERVAL '45 days',
    NOW() - INTERVAL '45 days', NOW() - INTERVAL '45 days'
  ),
  (
    v_b, 'wkr009.seq', 1, 'test', v_agg,
    '{}'::jsonb, 'completed',
    NOW() - INTERVAL '44 days',
    NOW() - INTERVAL '44 days', NOW() - INTERVAL '44 days'
  );

  v_r1 := public.purge_completed_outbox_events(1, 30);
  IF (v_r1->>'deleted')::INTEGER > 1 THEN
    RAISE EXCEPTION 'FAIL: I) first call deleted more than 1: %', v_r1;
  END IF;
  IF (v_r1->>'deleted')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'FAIL: I) first call expected deleted=1, got %', v_r1;
  END IF;

  SELECT COUNT(*) INTO v_left
  FROM public.outbox_events
  WHERE id IN (v_a, v_b);
  IF v_left <> 1 THEN
    RAISE EXCEPTION 'FAIL: I) expected 1 candidate left after first call, got %', v_left;
  END IF;

  v_r2 := public.purge_completed_outbox_events(1, 30);
  IF (v_r2->>'deleted')::INTEGER > 1 THEN
    RAISE EXCEPTION 'FAIL: I) second call deleted more than 1: %', v_r2;
  END IF;
  IF (v_r2->>'deleted')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'FAIL: I) second call expected deleted=1, got %', v_r2;
  END IF;

  SELECT COUNT(*) INTO v_left
  FROM public.outbox_events
  WHERE id IN (v_a, v_b);
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'FAIL: I) expected both candidates deleted, left %', v_left;
  END IF;

  RAISE NOTICE 'PASS: I) sequential batch=1 deleted one per call';
END $$;

ROLLBACK;
