-- ============================================================
-- F4-001 verification harness (BEGIN / ROLLBACK — non-destructive)
-- Requires migration 061 applied. Run manually in Supabase SQL editor
-- when validating production; do NOT leave committed rows.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_agency_id UUID := gen_random_uuid();
  v_agency_inactive UUID := gen_random_uuid();
  v_digest_date TEXT := '2099-01-15';
  v_result JSONB;
  v_count INTEGER;
  v_has_execute BOOLEAN;
BEGIN
  -- A) Function exists with DEFINER posture
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'schedule_agency_digests'
  ) THEN
    RAISE EXCEPTION 'FAIL: A) schedule_agency_digests missing';
  END IF;
  RAISE NOTICE 'PASS: A) schedule_agency_digests exists';

  -- B) emit_agency_event exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'emit_agency_event'
  ) THEN
    RAISE EXCEPTION 'FAIL: B) emit_agency_event missing';
  END IF;
  RAISE NOTICE 'PASS: B) emit_agency_event exists';

  -- C) service_role EXECUTE granted; not to anon
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'schedule_agency_digests'
      AND grantee = 'service_role'
      AND privilege_type = 'EXECUTE'
  ) INTO v_has_execute;
  IF NOT v_has_execute THEN
    RAISE EXCEPTION 'FAIL: C) service_role missing EXECUTE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'schedule_agency_digests'
      AND grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: C) public/anon/authenticated have EXECUTE';
  END IF;
  RAISE NOTICE 'PASS: C) EXECUTE grants';

  -- Seed isolated agencies (rolled back)
  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES
    (
      v_agency_id,
      'F4-001 Active',
      'f4a-' || LEFT(REPLACE(v_agency_id::text, '-', ''), 16),
      'f4-001-active@example.com',
      'active'
    ),
    (
      v_agency_inactive,
      'F4-001 Inactive',
      'f4i-' || LEFT(REPLACE(v_agency_inactive::text, '-', ''), 16),
      'f4-001-inactive@example.com',
      'inactive'
    );

  INSERT INTO public.agency_notification_preferences (
    agency_id, category, in_app_enabled, email_enabled
  ) VALUES
    (v_agency_id, 'ops_digest', TRUE, TRUE),
    (v_agency_inactive, 'ops_digest', TRUE, TRUE)
  ON CONFLICT (agency_id, category) DO UPDATE
    SET email_enabled = EXCLUDED.email_enabled;

  -- Isolate eligibility inside this transaction (ROLLBACK restores).
  UPDATE public.agency_notification_preferences
  SET email_enabled = FALSE
  WHERE category = 'ops_digest'
    AND agency_id NOT IN (v_agency_id, v_agency_inactive);

  -- D) Emits for active+email+prefs; skips inactive
  SELECT public.schedule_agency_digests(50, v_digest_date) INTO v_result;
  IF (v_result->>'emitted')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL: D) expected emit=1 for isolated active agency, got %', v_result;
  END IF;
  RAISE NOTICE 'PASS: D) emitted for active agency %', v_result;

  SELECT COUNT(*) INTO v_count
  FROM public.outbox_events
  WHERE dedup_key = 'agency.digest.due:' || v_agency_id::text || ':' || v_digest_date;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: D) expected 1 outbox row for active, got %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.outbox_events
  WHERE dedup_key = 'agency.digest.due:' || v_agency_inactive::text || ':' || v_digest_date;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: D) inactive agency must not emit';
  END IF;

  -- E) Idempotent re-poll
  SELECT public.schedule_agency_digests(50, v_digest_date) INTO v_result;
  IF (v_result->>'emitted')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL: E) re-poll must emit 0, got %', v_result;
  END IF;
  RAISE NOTICE 'PASS: E) idempotent re-poll';

  -- F) Payload shape / aggregate
  IF NOT EXISTS (
    SELECT 1 FROM public.outbox_events
    WHERE dedup_key = 'agency.digest.due:' || v_agency_id::text || ':' || v_digest_date
      AND event_type = 'agency.digest.due'
      AND event_version = 1
      AND aggregate_type = 'agency'
      AND aggregate_id = v_agency_id
      AND tenant_id = v_agency_id
      AND payload->>'agency_id' = v_agency_id::text
      AND payload->>'digest_date' = v_digest_date
      AND NOT (payload ? 'agency_email')
      AND NOT (payload ? 'booker_name')
  ) THEN
    RAISE EXCEPTION 'FAIL: F) outbox envelope/payload invalid';
  END IF;
  RAISE NOTICE 'PASS: F) envelope + no PII keys';

  -- G) Preference disabled → no emit for another date
  UPDATE public.agency_notification_preferences
  SET email_enabled = FALSE
  WHERE agency_id = v_agency_id AND category = 'ops_digest';

  SELECT public.schedule_agency_digests(50, '2099-01-16') INTO v_result;
  SELECT COUNT(*) INTO v_count
  FROM public.outbox_events
  WHERE dedup_key = 'agency.digest.due:' || v_agency_id::text || ':2099-01-16';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: G) disabled preference must not emit';
  END IF;
  RAISE NOTICE 'PASS: G) preference gate';

  -- H) ops_digest category present
  IF NOT EXISTS (
    SELECT 1 FROM public.agency_notification_preferences
    WHERE agency_id = v_agency_id AND category = 'ops_digest'
  ) THEN
    RAISE EXCEPTION 'FAIL: H) ops_digest preference missing';
  END IF;
  RAISE NOTICE 'PASS: H) ops_digest category';

  RAISE NOTICE 'F4-001 harness complete (ROLLBACK follows)';
END $$;

ROLLBACK;
