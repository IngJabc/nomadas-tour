-- ============================================================
-- AUD-020 P1 — Database verification (post-migration 043–046)
--
-- Pegar completo en Supabase → SQL Editor → Run
-- SQL puro (sin \echo ni meta-comandos de psql).
-- ============================================================

DO $$
DECLARE
  v_count INTEGER;
  v_text TEXT;
BEGIN
  -- ── ticket_code column / type ─────────────────────────────
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'reservations'
    AND column_name = 'ticket_code'
    AND data_type = 'character'
    AND character_maximum_length = 8;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: reservations.ticket_code CHAR(8) missing';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_constraint
  WHERE conname = 'reservations_ticket_code_format_check';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: reservations_ticket_code_format_check missing';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_constraint
  WHERE conname = 'reservations_ticket_code_key'
    AND contype = 'u';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: reservations_ticket_code_key UNIQUE missing';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.reservations
  WHERE ticket_code IS NOT NULL
    AND ticket_code::text <> UPPER(LEFT(REPLACE(id::text, '-', ''), 8));

  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'FAIL: % reservation(s) have ticket_code not derived from id',
      v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.reservations
  WHERE ticket_code IS NOT NULL
    AND ticket_code::text !~ '^[A-F0-9]{8}$';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: % ticket_code value(s) fail format check', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM (
    SELECT ticket_code
    FROM public.reservations
    WHERE ticket_code IS NOT NULL
    GROUP BY ticket_code
    HAVING COUNT(*) > 1
  ) c;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: % ticket_code collision group(s) remain', v_count;
  END IF;

  -- ── boarding_logs columns ─────────────────────────────────
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'boarding_logs'
    AND column_name IN ('trip_id', 'reservation_agency_id', 'state_before', 'state_after');

  IF v_count <> 4 THEN
    RAISE EXCEPTION 'FAIL: boarding_logs audit columns incomplete (%/4)', v_count;
  END IF;

  -- ── boarding_attempts ─────────────────────────────────────
  SELECT COUNT(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'boarding_attempts';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: boarding_attempts table missing';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'boarding_attempts';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: boarding_attempts must not be in supabase_realtime';
  END IF;

  -- ── boarding_toggle presence / security ───────────────────
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'boarding_toggle'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_passenger_id uuid, p_boarded boolean, p_actor_user_id uuid, p_operator_agency_id uuid';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: public.boarding_toggle(...) missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'boarding_toggle'
      AND p.prosecdef = TRUE
  ) THEN
    RAISE EXCEPTION 'FAIL: boarding_toggle is not SECURITY DEFINER';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'boarding_toggle'
      AND 'search_path=public' = ANY (p.proconfig)
  ) THEN
    RAISE EXCEPTION 'FAIL: boarding_toggle search_path is not public';
  END IF;

  SELECT r.rolname INTO v_text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE n.nspname = 'public'
    AND p.proname = 'boarding_toggle';

  RAISE NOTICE 'boarding_toggle owner: %', v_text;

  IF has_function_privilege(
    'anon',
    'public.boarding_toggle(uuid, boolean, uuid, uuid)',
    'execute'
  ) THEN
    RAISE EXCEPTION 'FAIL: anon can EXECUTE boarding_toggle';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.boarding_toggle(uuid, boolean, uuid, uuid)',
    'execute'
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated can EXECUTE boarding_toggle';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.boarding_toggle(uuid, boolean, uuid, uuid)',
    'execute'
  ) THEN
    RAISE EXCEPTION 'FAIL: service_role cannot EXECUTE boarding_toggle';
  END IF;

  RAISE NOTICE 'PASS: structural + grant checks';
END $$;

-- UNIQUE probe (subtransaction rolls back on unique_violation)
DO $$
DECLARE
  v_ids UUID[];
  v_id_a UUID;
  v_id_b UUID;
BEGIN
  SELECT ARRAY_AGG(id) INTO v_ids
  FROM (
    SELECT id
    FROM public.reservations
    WHERE ticket_code IS NOT NULL
    LIMIT 2
  ) s;

  IF v_ids IS NULL OR array_length(v_ids, 1) < 2 THEN
    RAISE NOTICE 'SKIP: UNIQUE probe needs ≥2 reservations with ticket_code';
    RETURN;
  END IF;

  v_id_a := v_ids[1];
  v_id_b := v_ids[2];

  BEGIN
    UPDATE public.reservations r1
    SET ticket_code = r2.ticket_code
    FROM public.reservations r2
    WHERE r1.id = v_id_b
      AND r2.id = v_id_a;

    RAISE EXCEPTION 'FAIL: UNIQUE did not reject duplicate ticket_code';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: UNIQUE rejects duplicate ticket_code';
  END;
END $$;

-- RPC deny unassigned agency (optional fixtures; no-op if missing data)
DO $$
DECLARE
  v_passenger_id UUID;
  v_actor_id UUID;
  v_operator_agency_id UUID;
  v_foreign_agency_id UUID;
  v_result JSONB;
BEGIN
  SELECT
    rp.id,
    u.id,
    ta.agency_id
  INTO
    v_passenger_id,
    v_actor_id,
    v_operator_agency_id
  FROM public.reservation_passengers rp
  JOIN public.reservations r ON r.id = rp.reservation_id
  JOIN public.trips t ON t.id = r.trip_id
  JOIN public.trip_agencies ta ON ta.trip_id = t.id
  JOIN public.users u ON u.agency_id = ta.agency_id
  WHERE rp.status = 'active'
    AND r.status <> 'cancelled'
    AND t.status = 'active'
    AND t.departure_time <= NOW()
  LIMIT 1;

  IF v_passenger_id IS NULL THEN
    RAISE NOTICE 'SKIP: RPC agency-deny probe — no suitable live fixture';
    RETURN;
  END IF;

  SELECT a.id
  INTO v_foreign_agency_id
  FROM public.agencies a
  WHERE a.id <> v_operator_agency_id
  LIMIT 1;

  IF v_foreign_agency_id IS NULL THEN
    RAISE NOTICE 'SKIP: RPC agency-deny probe — need a second agency';
    RETURN;
  END IF;

  BEGIN
    v_result := public.boarding_toggle(
      v_passenger_id,
      TRUE,
      v_actor_id,
      v_foreign_agency_id
    );
    RAISE EXCEPTION 'FAIL: RPC allowed foreign operator_agency_id';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM ILIKE '%no pertenece a la agencia operadora%'
         OR SQLERRM ILIKE '%no está asignada%' THEN
        RAISE NOTICE 'PASS: RPC rejects unauthorized agency context (% )', SQLERRM;
      ELSE
        RAISE EXCEPTION 'FAIL: unexpected RPC error: %', SQLERRM;
      END IF;
  END;
END $$;

-- Resultado visible en el SQL Editor
SELECT
  'AUD-020 P1 structural' AS check_name,
  'PASS' AS status,
  'ticket_code + boarding_logs + boarding_attempts + boarding_toggle grants' AS detail;
