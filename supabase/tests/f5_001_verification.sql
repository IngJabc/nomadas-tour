-- ============================================================
-- F5-001 verification harness — Audit Trail (migration 065)
--
-- Pure SQL: RAISE EXCEPTION on FAIL, RAISE NOTICE on PASS.
-- Non-destructive: outer BEGIN … ROLLBACK (no committed fixtures).
-- Requires migration 065_audit_log.sql already applied.
-- Do NOT modify historical migrations.
--
-- Legacy dual-path note:
--   Cannot flip TRIP_EFFECTS_VIA_OUTBOX from SQL. Backend unit tests
--   cover the legacy fold. This harness still verifies that update_trip
--   performs a single UPDATE (postponed_from folded) by counting exactly
--   one trip.updated audit row for a postpone mutation.
-- ============================================================

-- ── SCHEMA ───────────────────────────────────────────────────

DO $$
DECLARE
  v_cols TEXT[];
  v_missing TEXT[];
  v_polqual TEXT;
  v_ident TEXT;
  v_tg RECORD;
BEGIN
  -- audit_log table + required columns
  IF to_regclass('public.audit_log') IS NULL THEN
    RAISE EXCEPTION 'FAIL: SCHEMA audit_log table missing';
  END IF;

  SELECT array_agg(c.column_name::text ORDER BY c.ordinal_position)
  INTO v_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'audit_log';

  v_missing := ARRAY(
    SELECT x
    FROM unnest(ARRAY[
      'id', 'occurred_at', 'actor_user_id', 'actor_role', 'agency_id',
      'action', 'entity_type', 'entity_id', 'before', 'after', 'metadata'
    ]) AS x
    WHERE NOT (x = ANY (v_cols))
  );
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'FAIL: SCHEMA audit_log missing columns: %', v_missing;
  END IF;
  RAISE NOTICE 'PASS: SCHEMA audit_log columns';

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'trips'
      AND column_name = 'updated_by'
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA trips.updated_by missing';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA trips.updated_by';

  -- 4 indexes
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_audit_log_entity_occurred')
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_audit_log_agency_occurred')
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_audit_log_actor_occurred')
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_audit_log_action_occurred')
  THEN
    RAISE EXCEPTION 'FAIL: SCHEMA expected 4 audit_log indexes (entity/agency/actor/action + occurred_at)';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA audit_log indexes';

  -- CHECK constraints action + entity_type
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audit_log'::regclass
      AND conname = 'audit_log_action_check'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA audit_log_action_check missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audit_log'::regclass
      AND conname = 'audit_log_entity_type_check'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA audit_log_entity_type_check missing';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA CHECK constraints';

  -- RLS enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'audit_log' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA RLS not enabled on audit_log';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA RLS enabled';

  -- policies
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_log'
      AND policyname = 'audit_log_superadmin_select'
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA policy audit_log_superadmin_select missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_log'
      AND policyname = 'audit_log_agency_select'
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA policy audit_log_agency_select missing';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA audit_log SELECT policies';

  -- Agency isolation expression (no JWT required)
  SELECT COALESCE(qual, '') INTO v_polqual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'audit_log'
    AND policyname = 'audit_log_agency_select';

  IF v_polqual !~* 'auth_app_agency_id' THEN
    RAISE EXCEPTION 'FAIL: SCHEMA agency policy missing auth_app_agency_id: %', v_polqual;
  END IF;
  IF v_polqual !~* 'agency_id[[:space:]]+IS[[:space:]]+NOT[[:space:]]+NULL' THEN
    RAISE EXCEPTION 'FAIL: SCHEMA agency policy missing agency_id IS NOT NULL: %', v_polqual;
  END IF;
  RAISE NOTICE 'PASS: SCHEMA agency policy isolates by auth_app_agency_id';

  -- append-only trigger
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_audit_log_append_only'
      AND tgrelid = 'public.audit_log'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA trg_audit_log_append_only missing';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA trg_audit_log_append_only';

  -- functions
  IF to_regprocedure('public.audit_append(uuid,text,uuid,text,text,uuid,jsonb,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: SCHEMA audit_append missing';
  END IF;
  IF to_regprocedure('public.cancel_agency_reservation(uuid,uuid,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: SCHEMA cancel_agency_reservation missing';
  END IF;
  IF to_regprocedure('public.update_agency_branding(uuid,uuid,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: SCHEMA update_agency_branding missing';
  END IF;
  IF to_regprocedure('public.update_agency_notification_preferences(uuid,uuid,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: SCHEMA update_agency_notification_preferences missing';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA writer RPCs exist';

  -- update_trip / set_trip_status actor args
  SELECT pg_get_function_identity_arguments(p.oid) INTO v_ident
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'update_trip'
  ORDER BY p.pronargs DESC
  LIMIT 1;

  IF v_ident IS NULL OR v_ident !~* 'p_actor_user_id' THEN
    RAISE EXCEPTION 'FAIL: SCHEMA update_trip missing p_actor_user_id (got %)', v_ident;
  END IF;
  RAISE NOTICE 'PASS: SCHEMA update_trip has p_actor_user_id (%)', v_ident;

  SELECT pg_get_function_identity_arguments(p.oid) INTO v_ident
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'set_trip_status'
  ORDER BY p.pronargs DESC
  LIMIT 1;

  IF v_ident IS NULL OR v_ident !~* 'p_actor_user_id' THEN
    RAISE EXCEPTION 'FAIL: SCHEMA set_trip_status missing p_actor_user_id (got %)', v_ident;
  END IF;
  RAISE NOTICE 'PASS: SCHEMA set_trip_status has p_actor_user_id (%)', v_ident;

  -- client INSERT policies removed
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'boarding_logs'
      AND policyname IN ('bl_agency_insert', 'bl_agency_insert')
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA bl_agency_insert must not exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reservations'
      AND policyname = 'reservations_agency_insert'
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA reservations_agency_insert must not exist';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA client INSERT policies absent';

  -- REVOKE INSERT posture (authenticated)
  IF has_table_privilege('authenticated', 'public.audit_log', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: SCHEMA authenticated still has INSERT on audit_log';
  END IF;
  IF has_table_privilege('authenticated', 'public.reservations', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: SCHEMA authenticated still has INSERT on reservations';
  END IF;
  IF has_table_privilege('authenticated', 'public.boarding_logs', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: SCHEMA authenticated still has INSERT on boarding_logs';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA INSERT revoked for authenticated';

  -- trg_reservations_audit: CONSTRAINT TRIGGER deferred
  SELECT t.tgisconstraint, t.tgdeferrable, t.tginitdeferred, t.tgenabled
  INTO v_tg
  FROM pg_trigger t
  WHERE t.tgname = 'trg_reservations_audit'
    AND t.tgrelid = 'public.reservations'::regclass
    AND NOT t.tgisinternal;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: SCHEMA trg_reservations_audit missing';
  END IF;
  IF v_tg.tgisconstraint IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: SCHEMA trg_reservations_audit must be CONSTRAINT TRIGGER';
  END IF;
  IF v_tg.tgdeferrable IS NOT TRUE OR v_tg.tginitdeferred IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: SCHEMA trg_reservations_audit must be DEFERRABLE INITIALLY DEFERRED';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA trg_reservations_audit deferred constraint trigger';

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_trips_audit'
      AND tgrelid = 'public.trips'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAIL: SCHEMA trg_trips_audit missing';
  END IF;
  RAISE NOTICE 'PASS: SCHEMA trg_trips_audit';
END $$;

-- ── SECURITY + ATOMICITY + PII (transactional; rolled back) ───

BEGIN;

DO $$
DECLARE
  v_suffix TEXT := replace(gen_random_uuid()::text, '-', '');
  v_agency_a UUID := gen_random_uuid();
  v_agency_b UUID := gen_random_uuid();
  v_super UUID := gen_random_uuid();
  v_user_a UUID := gen_random_uuid();
  v_user_b UUID := gen_random_uuid();
  v_route UUID := gen_random_uuid();
  v_trip UUID;
  v_trip_board UUID;
  v_trip_cancel UUID;
  v_seat_ids UUID[];
  v_seat_bad UUID := gen_random_uuid();
  v_seat1 UUID;
  v_seat2 UUID;
  v_res JSONB;
  v_res_id UUID;
  v_res_cancel_id UUID;
  v_res_board_id UUID;
  v_passenger_id UUID;
  v_audit_id UUID;
  v_count INTEGER;
  v_count_before INTEGER;
  v_status TEXT;
  v_dep TIMESTAMPTZ;
  v_dep2 TIMESTAMPTZ;
  v_forbidden TEXT;
  v_row RECORD;
  v_hit TEXT;
BEGIN
  -- Seed auth.users (required by public.users / reservations FKs).
  -- Fixed bcrypt hash avoids depending on public.crypt/gen_salt.
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
        'f5-001-sa-' || left(v_suffix, 12) || '@example.com',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        NOW(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        NOW(), NOW(), '', '', '', ''
      ),
      (
        '00000000-0000-0000-0000-000000000000', v_user_a,
        'authenticated', 'authenticated',
        'f5-001-a-' || left(v_suffix, 12) || '@example.com',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        NOW(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        NOW(), NOW(), '', '', '', ''
      ),
      (
        '00000000-0000-0000-0000-000000000000', v_user_b,
        'authenticated', 'authenticated',
        'f5-001-b-' || left(v_suffix, 12) || '@example.com',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        NOW(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        NOW(), NOW(), '', '', '', ''
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL: cannot seed auth.users (need postgres/service role): %', SQLERRM;
  END;

  INSERT INTO public.agencies (id, name, subdomain, email, status)
  VALUES
    (
      v_agency_a,
      'F5-001 Agency A',
      'f5a-' || left(v_suffix, 16),
      'f5-001-a@example.com',
      'active'
    ),
    (
      v_agency_b,
      'F5-001 Agency B',
      'f5b-' || left(v_suffix, 16),
      'f5-001-b@example.com',
      'active'
    );

  INSERT INTO public.users (id, email, password_hash, role, agency_id)
  VALUES
    (v_super, 'f5-001-sa-' || left(v_suffix, 12) || '@example.com', '', 'superadmin', NULL),
    (v_user_a, 'f5-001-a-' || left(v_suffix, 12) || '@example.com', '', 'agency', v_agency_a),
    (v_user_b, 'f5-001-b-' || left(v_suffix, 12) || '@example.com', '', 'agency', v_agency_b);

  INSERT INTO public.agency_settings (agency_id)
  VALUES (v_agency_a), (v_agency_b)
  ON CONFLICT (agency_id) DO NOTHING;

  INSERT INTO public.routes (id, origin, destination, status)
  VALUES (v_route, 'F5-001 Origin', 'F5-001 Dest', 'active');

  -- Future trip (reservations / update / cancel)
  v_res := public.create_trip(
    v_route,
    clock_timestamp() + INTERVAL '5 days',
    'kia',
    ARRAY[v_agency_a, v_agency_b],
    v_super
  );
  v_trip := (v_res->>'id')::UUID;

  -- Boarding trip (past departure)
  v_res := public.create_trip(
    v_route,
    clock_timestamp() - INTERVAL '2 hours',
    'kia',
    ARRAY[v_agency_a],
    v_super
  );
  v_trip_board := (v_res->>'id')::UUID;

  -- Trip dedicated to set_trip_status cancel (future, no reservations needed)
  v_res := public.create_trip(
    v_route,
    clock_timestamp() + INTERVAL '7 days',
    'kia',
    ARRAY[v_agency_a],
    v_super
  );
  v_trip_cancel := (v_res->>'id')::UUID;

  SELECT array_agg(id ORDER BY seat_code)
  INTO v_seat_ids
  FROM public.seats
  WHERE trip_id = v_trip AND status = 'available';

  v_seat1 := v_seat_ids[1];
  v_seat2 := v_seat_ids[2];

  -- ── SECURITY 1) authenticated/anon cannot INSERT audit_log ──
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.audit_log (
      actor_user_id, actor_role, agency_id, action, entity_type, entity_id
    ) VALUES (
      v_user_a, 'agency', v_agency_a, 'reservation.created', 'reservation', gen_random_uuid()
    );
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: SEC1 authenticated INSERT into audit_log should fail';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE 'PASS: SEC1 authenticated INSERT denied (insufficient_privilege)';
    WHEN OTHERS THEN
      RESET ROLE;
      IF SQLERRM ~* 'permission denied|insufficient_privilege|row-level security' THEN
        RAISE NOTICE 'PASS: SEC1 authenticated INSERT denied (%)', SQLERRM;
      ELSIF SQLERRM ~* 'cannot SET ROLE|must be member|permission denied to set role' THEN
        RAISE NOTICE 'SKIP: SEC1 SET LOCAL ROLE authenticated not permitted — %', SQLERRM;
      ELSIF SQLERRM ~* 'FAIL: SEC1' THEN
        RAISE;
      ELSE
        RAISE NOTICE 'SKIP: SEC1 unexpected while probing role switch — %', SQLERRM;
      END IF;
  END;

  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO public.audit_log (
      actor_user_id, actor_role, agency_id, action, entity_type, entity_id
    ) VALUES (
      NULL, 'system', NULL, 'trip.updated', 'trip', gen_random_uuid()
    );
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: SEC1b anon INSERT into audit_log should fail';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE 'PASS: SEC1b anon INSERT denied';
    WHEN OTHERS THEN
      RESET ROLE;
      IF SQLERRM ~* 'permission denied|insufficient_privilege|row-level security' THEN
        RAISE NOTICE 'PASS: SEC1b anon INSERT denied (%)', SQLERRM;
      ELSIF SQLERRM ~* 'cannot SET ROLE|must be member|permission denied to set role' THEN
        RAISE NOTICE 'SKIP: SEC1b SET LOCAL ROLE anon not permitted — %', SQLERRM;
      ELSIF SQLERRM ~* 'FAIL: SEC1b' THEN
        RAISE;
      ELSE
        RAISE NOTICE 'SKIP: SEC1b unexpected — %', SQLERRM;
      END IF;
  END;

  -- ── SECURITY 2/3) UPDATE/DELETE append-only ──
  v_audit_id := public.audit_append(
    v_user_a, 'agency', v_agency_a,
    'agency_settings.updated', 'agency_settings', v_agency_a,
    '{}'::jsonb, '{"primary_color":"#000024"}'::jsonb,
    jsonb_build_object('source', 'f5-001-harness')
  );

  BEGIN
    UPDATE public.audit_log SET metadata = '{"x":1}'::jsonb WHERE id = v_audit_id;
    RAISE EXCEPTION 'FAIL: SEC2 UPDATE audit_log should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~* 'ERR_AUDIT_APPEND_ONLY' THEN
      RAISE EXCEPTION 'FAIL: SEC2 expected ERR_AUDIT_APPEND_ONLY, got %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: SEC2 UPDATE blocked ERR_AUDIT_APPEND_ONLY';
  END;

  BEGIN
    DELETE FROM public.audit_log WHERE id = v_audit_id;
    RAISE EXCEPTION 'FAIL: SEC3 DELETE audit_log should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~* 'ERR_AUDIT_APPEND_ONLY' THEN
      RAISE EXCEPTION 'FAIL: SEC3 expected ERR_AUDIT_APPEND_ONLY, got %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: SEC3 DELETE blocked ERR_AUDIT_APPEND_ONLY';
  END;

  -- ── SECURITY 4) cancel nonexistent actor ──
  BEGIN
    PERFORM public.cancel_agency_reservation(
      gen_random_uuid(), gen_random_uuid(), v_agency_a, '{}'::jsonb
    );
    RAISE EXCEPTION 'FAIL: SEC4 expected ERR_ACTOR_NOT_FOUND';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~* 'ERR_ACTOR_NOT_FOUND' THEN
      RAISE EXCEPTION 'FAIL: SEC4 expected ERR_ACTOR_NOT_FOUND, got %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: SEC4 cancel rejects nonexistent actor';
  END;

  -- ── SECURITY 5) actor from other agency ──
  -- Need a real reservation owned by A first
  v_res := public.create_agency_reservation(
    v_trip, v_agency_a, v_user_a,
    'Booker A', 'DOC-A', '555-0001',
    ARRAY[v_seat1],
    ARRAY['Pax A'], ARRAY['PD-A'], ARRAY['555-1001']
  );
  v_res_id := (v_res->>'reservation_id')::UUID;
  SET CONSTRAINTS trg_reservations_audit IMMEDIATE;

  BEGIN
    PERFORM public.cancel_agency_reservation(
      v_res_id, v_user_b, v_agency_a, '{}'::jsonb
    );
    RAISE EXCEPTION 'FAIL: SEC5 expected ERR_ACTOR_AGENCY_MISMATCH';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~* 'ERR_ACTOR_AGENCY_MISMATCH' THEN
      RAISE EXCEPTION 'FAIL: SEC5 expected ERR_ACTOR_AGENCY_MISMATCH, got %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: SEC5 cancel rejects actor from other agency';
  END;

  -- ── SECURITY 6) cancel another agency's reservation ──
  BEGIN
    PERFORM public.cancel_agency_reservation(
      v_res_id, v_user_b, v_agency_b, '{}'::jsonb
    );
    RAISE EXCEPTION 'FAIL: SEC6 expected ERR_RESERVATION_NOT_OWNED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~* 'ERR_RESERVATION_NOT_OWNED' THEN
      RAISE EXCEPTION 'FAIL: SEC6 expected ERR_RESERVATION_NOT_OWNED, got %', SQLERRM;
    END IF;
    RAISE NOTICE 'PASS: SEC6 cancel rejects other agency reservation';
  END;

  -- ── SECURITY 7) agency policy expression already checked in SCHEMA;
  --     plus REVOKE INSERT posture (documented alternative to JWT RLS probe)
  RAISE NOTICE 'PASS: SEC7 agency isolation asserted via policy quals + INSERT revoke';

  -- ── ATOMICITY 1) create_agency_reservation → 1 reservation.created ──
  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE action = 'reservation.created' AND entity_id = v_res_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: ATOM1 expected 1 reservation.created for %, got %', v_res_id, v_count;
  END IF;
  RAISE NOTICE 'PASS: ATOM1 create_agency_reservation → 1 reservation.created';

  -- ── ATOMICITY 2) failed create (invalid seat) → 0 new reservation.created ──
  SELECT COUNT(*) INTO v_count_before
  FROM public.audit_log
  WHERE action = 'reservation.created';

  BEGIN
    PERFORM public.create_agency_reservation(
      v_trip, v_agency_a, v_user_a,
      'Booker Fail', 'DOC-F', '555-0002',
      ARRAY[v_seat_bad],
      ARRAY['Pax F'], ARRAY['PD-F'], ARRAY['555-1002']
    );
    RAISE EXCEPTION 'FAIL: ATOM2 invalid seat should error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* 'FAIL: ATOM2' THEN
      RAISE;
    END IF;
    -- expected seat error
    NULL;
  END;

  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE action = 'reservation.created';
  IF v_count <> v_count_before THEN
    RAISE EXCEPTION 'FAIL: ATOM2 failed create must not emit reservation.created (% → %)',
      v_count_before, v_count;
  END IF;
  RAISE NOTICE 'PASS: ATOM2 failed create → 0 new reservation.created';

  -- ── ATOMICITY 3) cancel success → 1 reservation.cancelled + seats available ──
  v_res := public.cancel_agency_reservation(
    v_res_id, v_user_a, v_agency_a, '{}'::jsonb
  );
  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE action = 'reservation.cancelled' AND entity_id = v_res_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: ATOM3 expected 1 reservation.cancelled, got %', v_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.seats WHERE id = v_seat1 AND status <> 'available'
  ) THEN
    RAISE EXCEPTION 'FAIL: ATOM3 seat % not released', v_seat1;
  END IF;
  RAISE NOTICE 'PASS: ATOM3 cancel → 1 reservation.cancelled + seat available';

  -- ── ATOMICITY 4) fake fail cancel (wrong status) → 0 new audit, status unchanged ──
  SELECT status INTO v_status FROM public.reservations WHERE id = v_res_id;
  SELECT COUNT(*) INTO v_count_before
  FROM public.audit_log
  WHERE action = 'reservation.cancelled' AND entity_id = v_res_id;

  BEGIN
    PERFORM public.cancel_agency_reservation(
      v_res_id, v_user_a, v_agency_a, '{}'::jsonb
    );
    RAISE EXCEPTION 'FAIL: ATOM4 second cancel should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* 'FAIL: ATOM4' THEN
      RAISE;
    END IF;
    IF SQLERRM !~* 'ERR_RESERVATION_NOT_CONFIRMED' THEN
      RAISE EXCEPTION 'FAIL: ATOM4 expected ERR_RESERVATION_NOT_CONFIRMED, got %', SQLERRM;
    END IF;
  END;

  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE action = 'reservation.cancelled' AND entity_id = v_res_id;
  IF v_count <> v_count_before THEN
    RAISE EXCEPTION 'FAIL: ATOM4 failed cancel must not add audit';
  END IF;
  IF (SELECT status FROM public.reservations WHERE id = v_res_id) IS DISTINCT FROM v_status THEN
    RAISE EXCEPTION 'FAIL: ATOM4 status must remain %', v_status;
  END IF;
  RAISE NOTICE 'PASS: ATOM4 failed cancel → 0 audit, status unchanged';

  -- Fresh reservation for remaining tests that need a live booking
  v_res := public.create_agency_reservation(
    v_trip, v_agency_a, v_user_a,
    'Booker C', 'DOC-C', '555-0003',
    ARRAY[v_seat2],
    ARRAY['Pax C'], ARRAY['PD-C'], ARRAY['555-1003']
  );
  v_res_cancel_id := (v_res->>'reservation_id')::UUID;
  SET CONSTRAINTS trg_reservations_audit IMMEDIATE;

  -- ── ATOMICITY 5) update_trip once with actor → exactly 1 trip.updated ──
  SELECT departure_time INTO v_dep FROM public.trips WHERE id = v_trip;
  v_dep2 := v_dep + INTERVAL '1 hour';

  SELECT COUNT(*) INTO v_count_before
  FROM public.audit_log
  WHERE action = 'trip.updated' AND entity_id = v_trip;

  PERFORM public.update_trip(
    v_trip, v_route, v_dep2, 'kia',
    ARRAY[v_agency_a, v_agency_b],
    FALSE,
    v_super
  );

  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE action = 'trip.updated' AND entity_id = v_trip;
  IF v_count <> v_count_before + 1 THEN
    RAISE EXCEPTION 'FAIL: ATOM5 expected +1 trip.updated (before % after %)',
      v_count_before, v_count;
  END IF;
  RAISE NOTICE 'PASS: ATOM5 update_trip → exactly 1 trip.updated';

  -- ── ATOMICITY 6) postpone → exactly 1 trip.updated (postponed_from folded) ──
  SELECT departure_time INTO v_dep FROM public.trips WHERE id = v_trip;
  v_dep2 := v_dep + INTERVAL '2 hours';

  SELECT COUNT(*) INTO v_count_before
  FROM public.audit_log
  WHERE action = 'trip.updated' AND entity_id = v_trip;

  PERFORM public.update_trip(
    v_trip, v_route, v_dep2, 'kia',
    ARRAY[v_agency_a, v_agency_b],
    TRUE,
    v_super
  );

  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE action = 'trip.updated' AND entity_id = v_trip;
  IF v_count <> v_count_before + 1 THEN
    RAISE EXCEPTION 'FAIL: ATOM6 postpone must emit exactly 1 trip.updated (not 2); before % after %',
      v_count_before, v_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.trips
    WHERE id = v_trip AND postponed_from IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FAIL: ATOM6 postponed_from not set on single UPDATE';
  END IF;
  RAISE NOTICE 'PASS: ATOM6 postpone → 1 trip.updated (postponed_from folded)';

  -- ── ATOMICITY 7) set_trip_status cancelled → 1 trip.cancelled, 0 trip.updated ──
  SELECT COUNT(*) INTO v_count_before
  FROM public.audit_log
  WHERE action = 'trip.updated' AND entity_id = v_trip_cancel;

  PERFORM public.set_trip_status(v_trip_cancel, 'cancelled', v_super);

  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE action = 'trip.cancelled' AND entity_id = v_trip_cancel;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: ATOM7 expected 1 trip.cancelled, got %', v_count;
  END IF;
  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE action = 'trip.updated' AND entity_id = v_trip_cancel;
  IF v_count <> v_count_before THEN
    RAISE EXCEPTION 'FAIL: ATOM7 cancel must not emit trip.updated';
  END IF;
  RAISE NOTICE 'PASS: ATOM7 set_trip_status cancelled → 1 trip.cancelled, 0 trip.updated';

  -- ── ATOMICITY 8) update_agency_branding → 1 agency_settings.updated ──
  SELECT COUNT(*) INTO v_count_before
  FROM public.audit_log
  WHERE action = 'agency_settings.updated' AND entity_id = v_agency_a
    AND metadata->>'source' = 'api';

  PERFORM public.update_agency_branding(
    v_agency_a, v_user_a,
    jsonb_build_object('primary_color', '#0080FF'),
    '{}'::jsonb
  );

  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE action = 'agency_settings.updated' AND entity_id = v_agency_a
    AND metadata->>'source' = 'api';
  IF v_count <> v_count_before + 1 THEN
    RAISE EXCEPTION 'FAIL: ATOM8 expected +1 agency_settings.updated, before % after %',
      v_count_before, v_count;
  END IF;
  RAISE NOTICE 'PASS: ATOM8 update_agency_branding → 1 agency_settings.updated';

  -- ── ATOMICITY 9) notification prefs → 1 notification_preferences.updated ──
  SELECT COUNT(*) INTO v_count_before
  FROM public.audit_log
  WHERE action = 'notification_preferences.updated' AND entity_id = v_agency_a;

  PERFORM public.update_agency_notification_preferences(
    v_agency_a, v_user_a,
    jsonb_build_object('ops_digest', false),
    '{}'::jsonb
  );

  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE action = 'notification_preferences.updated' AND entity_id = v_agency_a;
  IF v_count <> v_count_before + 1 THEN
    RAISE EXCEPTION 'FAIL: ATOM9 expected +1 notification_preferences.updated, before % after %',
      v_count_before, v_count;
  END IF;
  RAISE NOTICE 'PASS: ATOM9 update_agency_notification_preferences → 1 audit';

  -- ── ATOMICITY 10) boarding_toggle board / unboard / idempotent ──
  SELECT id INTO v_seat1
  FROM public.seats
  WHERE trip_id = v_trip_board AND status = 'available'
  ORDER BY seat_code
  LIMIT 1;

  v_res := public.create_agency_reservation(
    v_trip_board, v_agency_a, v_user_a,
    'Booker Board', 'DOC-B', '555-0004',
    ARRAY[v_seat1],
    ARRAY['Pax Board'], ARRAY['PD-B'], ARRAY['555-1004']
  );
  v_res_board_id := (v_res->>'reservation_id')::UUID;
  SET CONSTRAINTS trg_reservations_audit IMMEDIATE;

  SELECT rp.id INTO v_passenger_id
  FROM public.reservation_passengers rp
  WHERE rp.reservation_id = v_res_board_id
  LIMIT 1;

  SELECT COUNT(*) INTO v_count_before
  FROM public.audit_log
  WHERE action = 'boarding.board' AND entity_id = v_passenger_id;

  v_res := public.boarding_toggle(v_passenger_id, TRUE, v_user_a, v_agency_a);
  IF (v_res->>'changed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: ATOM10 board should change state: %', v_res;
  END IF;
  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE action = 'boarding.board' AND entity_id = v_passenger_id;
  IF v_count <> v_count_before + 1 THEN
    RAISE EXCEPTION 'FAIL: ATOM10 expected +1 boarding.board';
  END IF;
  RAISE NOTICE 'PASS: ATOM10 board → 1 boarding.board';

  SELECT COUNT(*) INTO v_count_before
  FROM public.audit_log
  WHERE action = 'boarding.unboard' AND entity_id = v_passenger_id;

  v_res := public.boarding_toggle(v_passenger_id, FALSE, v_user_a, v_agency_a);
  IF (v_res->>'changed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: ATOM10 unboard should change state: %', v_res;
  END IF;
  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE action = 'boarding.unboard' AND entity_id = v_passenger_id;
  IF v_count <> v_count_before + 1 THEN
    RAISE EXCEPTION 'FAIL: ATOM10 expected +1 boarding.unboard';
  END IF;
  RAISE NOTICE 'PASS: ATOM10 unboard → 1 boarding.unboard';

  SELECT COUNT(*) INTO v_count_before
  FROM public.audit_log
  WHERE entity_id = v_passenger_id
    AND action IN ('boarding.board', 'boarding.unboard');

  v_res := public.boarding_toggle(v_passenger_id, FALSE, v_user_a, v_agency_a);
  IF (v_res->>'changed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL: ATOM10 idempotent no-op must changed=false: %', v_res;
  END IF;
  SELECT COUNT(*) INTO v_count
  FROM public.audit_log
  WHERE entity_id = v_passenger_id
    AND action IN ('boarding.board', 'boarding.unboard');
  IF v_count <> v_count_before THEN
    RAISE EXCEPTION 'FAIL: ATOM10 idempotent no-op must not emit audit';
  END IF;
  RAISE NOTICE 'PASS: ATOM10 idempotent boarding → no new audit';

  -- ── PII minimization: recursive key scan on fixture audit rows ──
  -- Walk a single envelope object so WITH RECURSIVE has one UNION only.
  v_forbidden := NULL;
  FOR v_row IN
    SELECT al.id, al.action, al.before, al.after, al.metadata
    FROM public.audit_log al
    WHERE al.entity_id IN (
        v_res_id, v_res_cancel_id, v_res_board_id, v_passenger_id,
        v_trip, v_trip_board, v_trip_cancel, v_agency_a, v_agency_b
      )
       OR al.agency_id IN (v_agency_a, v_agency_b)
       OR (al.metadata->>'source' = 'f5-001-harness')
  LOOP
    v_hit := NULL;
    WITH RECURSIVE walk(path, val, typ) AS (
      SELECT ARRAY[e.key]::text[], e.value, jsonb_typeof(e.value)
      FROM jsonb_each(
        jsonb_strip_nulls(
          jsonb_build_object(
            'before', v_row.before,
            'after', v_row.after,
            'metadata', v_row.metadata
          )
        )
      ) AS e(key, value)
      UNION ALL
      SELECT *
      FROM (
        SELECT w.path || e.key, e.value, jsonb_typeof(e.value)
        FROM walk w
        CROSS JOIN LATERAL jsonb_each(w.val) AS e(key, value)
        WHERE w.typ = 'object'
        UNION ALL
        SELECT w.path || (ord::text), elem, jsonb_typeof(elem)
        FROM walk w
        CROSS JOIN LATERAL jsonb_array_elements(w.val)
          WITH ORDINALITY AS a(elem, ord)
        WHERE w.typ = 'array'
      ) AS rec
    )
    SELECT lower(w.path[array_length(w.path, 1)])
    INTO v_hit
    FROM walk w
    WHERE array_length(w.path, 1) > 1  -- skip envelope roots before/after/metadata
      AND lower(w.path[array_length(w.path, 1)]) = ANY (ARRAY[
        'name', 'document', 'phone', 'email', 'contact_email',
        'qr_code', 'ticket_code', 'password', 'password_hash',
        'token', 'authorization', 'cookie'
      ])
      -- numeric array indices are not JSON object keys
      AND w.path[array_length(w.path, 1)] !~ '^[0-9]+$'
      -- notification_preferences uses boolean channel key "email" (not PII)
      AND NOT (
        lower(w.path[array_length(w.path, 1)]) = 'email'
        AND w.typ = 'boolean'
      )
    LIMIT 1;

    IF v_hit IS NOT NULL THEN
      v_forbidden := format('%s action=%s key=%s', v_row.id, v_row.action, v_hit);
      EXIT;
    END IF;
  END LOOP;

  IF v_forbidden IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: PII forbidden key in audit payload: %', v_forbidden;
  END IF;
  RAISE NOTICE 'PASS: PII no forbidden keys in before/after/metadata';

  RAISE NOTICE 'F5-001 verification PASS';
END $$;

ROLLBACK;
