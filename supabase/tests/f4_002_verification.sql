-- ============================================================
-- F4-002 verification harness (BEGIN / ROLLBACK — non-destructive)
-- Requires migration 062 applied. Run manually in Supabase SQL editor
-- when validating production; do NOT leave committed rows.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_result BOOLEAN;
  v_count INTEGER;
  v_has_execute BOOLEAN;
  v_is_definer BOOLEAN;
  v_search_path TEXT;
  v_sa UUID;
  v_dedup TEXT := 'superadmin.digest.due:2099-01-15';
  v_aggregate UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
BEGIN
  -- A) Function exists with DEFINER posture
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'emit_platform_event'
  ) THEN
    RAISE EXCEPTION 'FAIL: A) emit_platform_event missing';
  END IF;

  SELECT prosecdef INTO v_is_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'emit_platform_event';

  IF v_is_definer IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: A) emit_platform_event is not SECURITY DEFINER';
  END IF;

  SELECT array_to_string(p.proconfig, ',') INTO v_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'emit_platform_event';

  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'FAIL: A) search_path is not public: %', v_search_path;
  END IF;
  RAISE NOTICE 'PASS: A) emit_platform_event exists DEFINER search_path=public';

  -- B) service_role EXECUTE granted; not to anon/authenticated/PUBLIC
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'emit_platform_event'
      AND grantee = 'service_role'
      AND privilege_type = 'EXECUTE'
  ) INTO v_has_execute;
  IF NOT v_has_execute THEN
    RAISE EXCEPTION 'FAIL: B) service_role missing EXECUTE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'emit_platform_event'
      AND grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: B) public/anon/authenticated have EXECUTE';
  END IF;
  RAISE NOTICE 'PASS: B) RPC EXECUTE grants';

  -- C) Prefs table + backfill only superadmins
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'superadmin_notification_preferences'
  ) THEN
    RAISE EXCEPTION 'FAIL: C) superadmin_notification_preferences missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.role = 'superadmin'
      AND NOT EXISTS (
        SELECT 1
        FROM public.superadmin_notification_preferences p
        WHERE p.user_id = u.id
          AND p.category = 'superadmin_digest'
      )
  ) THEN
    RAISE EXCEPTION 'FAIL: C) backfill missing prefs for an existing superadmin';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.superadmin_notification_preferences p
    JOIN public.users u ON u.id = p.user_id
    WHERE u.role <> 'superadmin'
  ) THEN
    RAISE EXCEPTION 'FAIL: C) prefs exist for non-superadmin';
  END IF;
  RAISE NOTICE 'PASS: C) prefs table + superadmin-only backfill';

  -- D) Opt-out write is allowed (rolled back)
  SELECT u.id INTO v_sa
  FROM public.users u
  WHERE u.role = 'superadmin'
  LIMIT 1;

  IF v_sa IS NOT NULL THEN
    UPDATE public.superadmin_notification_preferences
    SET email_enabled = FALSE, updated_at = NOW()
    WHERE user_id = v_sa
      AND category = 'superadmin_digest';

    IF NOT EXISTS (
      SELECT 1
      FROM public.superadmin_notification_preferences
      WHERE user_id = v_sa
        AND category = 'superadmin_digest'
        AND email_enabled = FALSE
    ) THEN
      RAISE EXCEPTION 'FAIL: D) opt-out update failed';
    END IF;
    RAISE NOTICE 'PASS: D) opt-out';
  ELSE
    RAISE NOTICE 'PASS: D) opt-out skipped (no superadmin in this database)';
  END IF;

  -- E) Daily dedup via emit_platform_event
  SELECT public.emit_platform_event(
    'superadmin.digest.due',
    'platform',
    v_aggregate,
    NULL,
    jsonb_build_object('digest_date', '2099-01-15'),
    v_dedup,
    NOW()
  ) INTO v_result;

  IF v_result IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: E) first emit should insert';
  END IF;

  SELECT public.emit_platform_event(
    'superadmin.digest.due',
    'platform',
    v_aggregate,
    NULL,
    jsonb_build_object('digest_date', '2099-01-15'),
    v_dedup,
    NOW()
  ) INTO v_result;

  IF v_result IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: E) second emit should be a no-op';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.outbox_events
  WHERE dedup_key = v_dedup;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: E) expected 1 outbox row, got %', v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.outbox_events
    WHERE dedup_key = v_dedup
      AND (tenant_id IS NOT NULL OR aggregate_type <> 'platform')
  ) THEN
    RAISE EXCEPTION 'FAIL: E) tenant_id must be NULL and aggregate_type platform';
  END IF;
  RAISE NOTICE 'PASS: E) daily dedup';

  -- F) Invalid category rejected
  IF v_sa IS NULL THEN
    RAISE NOTICE 'PASS: F) category check skipped (no superadmin in this database)';
  ELSE
    BEGIN
      INSERT INTO public.superadmin_notification_preferences (
        user_id, category
      ) VALUES (v_sa, 'ops_digest');
      RAISE EXCEPTION 'FAIL: F) invalid category was accepted';
    EXCEPTION
      WHEN check_violation THEN
        RAISE NOTICE 'PASS: F) category check';
      WHEN unique_violation THEN
        RAISE EXCEPTION 'FAIL: F) invalid category hit unique instead of check';
    END;
  END IF;
END;
$$;

ROLLBACK;
