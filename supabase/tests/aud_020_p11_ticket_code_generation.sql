-- ============================================================
-- AUD-020.11 — Verify create_agency_reservation persists ticket_code
--
-- Pegar completo en Supabase → SQL Editor → Run
-- (SQL puro: sin \echo ni meta-comandos de psql)
-- Ejecutar DESPUÉS de aplicar la migración 047.
-- ============================================================

-- 1) La función debe existir y contener ticket_code derivado del UUID
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_agency_reservation'
  LIMIT 1;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'FAIL: create_agency_reservation missing';
  END IF;

  IF position('ticket_code' IN lower(v_def)) = 0 THEN
    RAISE EXCEPTION 'FAIL: create_agency_reservation body has no ticket_code';
  END IF;

  IF position('v_ticket_code' IN lower(v_def)) = 0 THEN
    RAISE EXCEPTION 'FAIL: v_ticket_code variable missing from function body';
  END IF;

  IF position('left(replace(v_reservation_id' IN lower(v_def)) = 0 THEN
    RAISE EXCEPTION 'FAIL: ticket_code not derived from reservation UUID';
  END IF;

  RAISE NOTICE 'PASS: create_agency_reservation includes ticket_code from UUID';
END $$;

-- 2) Resultado visible en el editor (Success + esta fila)
SELECT
  'AUD-020.11 function check' AS check_name,
  'PASS' AS status,
  'create_agency_reservation defines ticket_code from reservation UUID' AS detail;

-- 3) Smoke post-creación: corre DESPUÉS de crear una reserva nueva en la app
--    (descomenta solo este bloque si ya creaste una reserva tras aplicar 047)
/*
SELECT
  id,
  ticket_code,
  qr_code,
  UPPER(LEFT(REPLACE(id::text, '-', ''), 8)) AS expected_ticket_code,
  (ticket_code IS NOT NULL) AS has_ticket_code,
  (ticket_code::text ~ '^[A-F0-9]{8}$') AS format_ok,
  (ticket_code::text = UPPER(LEFT(REPLACE(id::text, '-', ''), 8))) AS matches_uuid_prefix
FROM public.reservations
ORDER BY created_at DESC NULLS LAST
LIMIT 1;
*/
