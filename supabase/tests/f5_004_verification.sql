-- ============================================================
-- F5-004 verification harness — Reserva asistida por enlace
-- (migrations 067, 068, 069)
--
-- Pure SQL: RAISE EXCEPTION on FAIL, RAISE NOTICE on PASS.
-- Non-destructive: outer BEGIN … ROLLBACK.
-- Requires 067–069 already applied.
-- Do NOT modify historical migrations.
-- ============================================================

BEGIN;

-- ── SCHEMA ───────────────────────────────────────────────────

DO $$
DECLARE
  v_cols TEXT[];
  v_missing TEXT[];
BEGIN
  IF to_regclass('public.reservation_links') IS NULL THEN
    RAISE EXCEPTION 'FAIL: SCHEMA reservation_links missing';
  END IF;
  IF to_regclass('public.reservation_link_seats') IS NULL THEN
    RAISE EXCEPTION 'FAIL: SCHEMA reservation_link_seats missing';
  END IF;

  SELECT array_agg(c.column_name::text ORDER BY c.ordinal_position)
  INTO v_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'reservation_links';

  v_missing := ARRAY(
    SELECT x FROM unnest(ARRAY[
      'id','token_hash','trip_id','agency_id','created_by','status',
      'expires_at','link_data','trip_snapshot','created_at','updated_at'
    ]) AS x
    WHERE NOT (x = ANY (v_cols))
  );
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'FAIL: SCHEMA reservation_links missing columns: %', v_missing;
  END IF;
  RAISE NOTICE 'PASS: SCHEMA reservation_links columns';

  SELECT array_agg(c.column_name::text)
  INTO v_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'reservation_link_seats';

  v_missing := ARRAY(
    SELECT x FROM unnest(ARRAY['id','link_id','seat_id','seat_code','is_active']) AS x
    WHERE NOT (x = ANY (v_cols))
  );
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'FAIL: SCHEMA reservation_link_seats missing columns: %', v_missing;
  END IF;
  RAISE NOTICE 'PASS: SCHEMA reservation_link_seats columns';

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seats' AND column_name = 'lock_expires_at'
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA seats.lock_expires_at missing';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA seats.lock_expires_at';

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'idx_reservation_link_seats_active_seat' AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA partial unique idx_reservation_link_seats_active_seat missing';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA active-seat unique index';

  -- trip_id ON DELETE RESTRICT
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.reservation_links'::regclass
      AND c.contype = 'f'
      AND c.confdeltype = 'r'
      AND pg_get_constraintdef(c.oid) ILIKE '%trips%'
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA trip_id must be ON DELETE RESTRICT';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA trip_id ON DELETE RESTRICT';
END $$;

-- ── RLS / GRANTS ─────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'reservation_links' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'FAIL: RLS not enabled on reservation_links';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'reservation_link_seats' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'FAIL: RLS not enabled on reservation_link_seats';
  END IF;
  RAISE NOTICE 'PASS: RLS enabled';

-- reservation_links:
  --   anon SELECT: DENIED
  --   authenticated SELECT: ALLOWED for Realtime (RLS restricts rows to agency)
  IF has_table_privilege('anon', 'public.reservation_links', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon must not SELECT reservation_links';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.reservation_links', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: authenticated must have SELECT on reservation_links for Realtime';
  END IF;

  -- reservation_link_seats:
  --   anon SELECT: DENIED
  --   authenticated SELECT: DENIED (no direct access; RPCs only)
  IF has_table_privilege('anon', 'public.reservation_link_seats', 'SELECT')
     OR has_table_privilege('authenticated', 'public.reservation_link_seats', 'SELECT')
  THEN
    RAISE EXCEPTION 'FAIL: anon/authenticated must not SELECT reservation_link_seats';
  END IF;

RAISE NOTICE 'PASS: GRANT model correct (anon denied, authenticated SELECT on links only)';
END $$;

-- ── RLS policy: agency-scoped SELECT on reservation_links ─────────
-- Verifies the policy exists and restricts rows by agency_id

DO $$
DECLARE
  v_poldef TEXT;
BEGIN
  -- Check policy exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.reservation_links'::regclass
      AND polname = 'reservation_links_agency_select'
  ) THEN
    RAISE EXCEPTION 'FAIL: policy reservation_links_agency_select missing';
  END IF;

  -- Check policy is FOR SELECT
  SELECT pg_get_expr(polqual, polrelid) INTO v_poldef
  FROM pg_policy
  WHERE polrelid = 'public.reservation_links'::regclass
    AND polname = 'reservation_links_agency_select';

  IF v_poldef IS NULL THEN
    RAISE EXCEPTION 'FAIL: reservation_links_agency_select has no USING clause';
  END IF;

  -- Verify the policy checks auth_app_role = 'agency' AND agency_id = auth_app_agency_id()
  IF v_poldef NOT ILIKE '%auth_app_role()%' THEN
    RAISE EXCEPTION 'FAIL: policy missing auth_app_role check';
  END IF;
  IF v_poldef NOT ILIKE '%auth_app_agency_id()%' THEN
    RAISE EXCEPTION 'FAIL: policy missing auth_app_agency_id check';
  END IF;
  IF v_poldef NOT ILIKE '%agency_id%' THEN
    RAISE EXCEPTION 'FAIL: policy missing agency_id restriction';
  END IF;

  RAISE NOTICE 'PASS: reservation_links_agency_select restricts by agency';
END $$;

-- ── FUNCTIONS ────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regprocedure('public.create_reservation_link(uuid,uuid,uuid,text,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'FAIL: create_reservation_link missing';
  END IF;
  IF to_regprocedure('public.confirm_reservation_from_link(uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: confirm_reservation_from_link missing';
  END IF;
  IF to_regprocedure('public.regenerate_reservation_link(uuid,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: regenerate_reservation_link missing';
  END IF;
  IF to_regprocedure('public.cancel_reservation_link(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: cancel_reservation_link missing';
  END IF;
  IF to_regprocedure('public.public_get_reservation_link(text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: public_get_reservation_link missing';
  END IF;
  IF to_regprocedure('public.public_save_reservation_link(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: public_save_reservation_link missing';
  END IF;
  IF to_regprocedure('public.patch_reservation_link_data(uuid,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: patch_reservation_link_data missing';
  END IF;
  IF to_regprocedure('public.create_reservation_core(uuid,uuid,uuid,text,text,text,uuid[],text[],text[],text[])') IS NULL THEN
    RAISE EXCEPTION 'FAIL: create_reservation_core missing';
  END IF;
  RAISE NOTICE 'PASS: RPCs exist';

  IF has_function_privilege('anon', 'public.public_get_reservation_link(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.public_get_reservation_link(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_reservation_link(uuid,uuid,uuid,text,uuid[])', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'FAIL: EXECUTE must be revoked from anon/authenticated';
  END IF;
  RAISE NOTICE 'PASS: RPC EXECUTE revoked from anon/authenticated';
END $$;

-- ── TRIGGERS ─────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_active_on_seat_link'
      AND tgrelid = 'public.reservation_link_seats'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAIL: trg_sync_active_on_seat_link missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_link_status'
      AND tgrelid = 'public.reservation_links'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAIL: trg_sync_link_status missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_seats_clear_lock_on_available'
      AND tgrelid = 'public.seats'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAIL: trg_seats_clear_lock_on_available missing';
  END IF;
  RAISE NOTICE 'PASS: triggers exist';
END $$;

-- ── CHECK constraints (audit + notifications) ────────────────

DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.audit_log'::regclass
    AND c.conname = 'audit_log_action_check';
  IF v_def IS NULL OR v_def NOT ILIKE '%reservation_link.created%' THEN
    RAISE EXCEPTION 'FAIL: audit_log_action_check missing reservation_link actions';
  END IF;
  IF v_def NOT ILIKE '%reservation_link.passenger_data_saved%' THEN
    RAISE EXCEPTION 'FAIL: audit_log_action_check missing passenger_data_saved';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.audit_log'::regclass
    AND c.conname = 'audit_log_entity_type_check';
  IF v_def IS NULL OR v_def NOT ILIKE '%reservation_link%' THEN
    RAISE EXCEPTION 'FAIL: audit_log_entity_type_check missing reservation_link';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.notifications'::regclass
    AND c.conname = 'notifications_type_check';
  IF v_def IS NULL OR v_def NOT ILIKE '%reservation_link_passenger_data%' THEN
    RAISE EXCEPTION 'FAIL: notifications_type_check missing reservation_link_passenger_data';
  END IF;
  RAISE NOTICE 'PASS: CHECK constraints include F5-004 values';
END $$;

-- ── sanitize: seat_code only, exact set ──────────────────────

DO $$
DECLARE
  v_out JSONB;
BEGIN
  v_out := public.reservation_link_sanitize_link_data(
    '{"booker_name":"A","passengers":[{"seat_code":"A1","name":"N","document":"D","phone":"","seat_id":"deadbeef-dead-4ead-8ead-deadbeefdead"}]}'::jsonb,
    ARRAY['A1']::TEXT[]
  );
  IF v_out->'passengers'->0 ? 'seat_id' THEN
    RAISE EXCEPTION 'FAIL: sanitize must strip seat_id';
  END IF;
  IF (v_out->'passengers'->0->>'seat_code') IS DISTINCT FROM 'A1' THEN
    RAISE EXCEPTION 'FAIL: sanitize must keep seat_code';
  END IF;
  RAISE NOTICE 'PASS: sanitize strips seat_id';

  BEGIN
    PERFORM public.reservation_link_sanitize_link_data(
      '{"passengers":[{"seat_code":"Z9","name":"","document":"","phone":""}]}'::jsonb,
      ARRAY['A1']::TEXT[]
    );
    RAISE EXCEPTION 'FAIL: extra seat_code must raise';
  EXCEPTION
    WHEN others THEN
      IF SQLERRM NOT ILIKE '%ERR_SEAT_NOT_IN_LINK%' THEN
        RAISE EXCEPTION 'FAIL: expected ERR_SEAT_NOT_IN_LINK, got %', SQLERRM;
      END IF;
  END;
  RAISE NOTICE 'PASS: sanitize rejects unknown seat_code';
END $$;

-- ── public GET unknown token ─────────────────────────────────

DO $$
DECLARE
  v_json JSONB;
BEGIN
  v_json := public.public_get_reservation_link(repeat('ab', 32));
  IF (v_json->>'ok')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: unknown token must not be ok';
  END IF;
  IF v_json->>'error_code' IS DISTINCT FROM 'LINK_NOT_FOUND' THEN
    RAISE EXCEPTION 'FAIL: expected LINK_NOT_FOUND, got %', v_json->>'error_code';
  END IF;
  RAISE NOTICE 'PASS: public_get unknown token → LINK_NOT_FOUND';
END $$;

ROLLBACK;
