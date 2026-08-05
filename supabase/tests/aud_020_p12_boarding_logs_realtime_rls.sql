-- ============================================================
-- AUD-020.12 — Verify boarding_logs SELECT allows trip-assigned agencies
--
-- Pegar en Supabase → SQL Editor (SQL puro, sin \echo).
-- Ejecutar DESPUÉS de aplicar migración 048.
-- ============================================================

DO $$
DECLARE
  v_qual TEXT;
BEGIN
  SELECT qual INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'boarding_logs'
    AND policyname = 'bl_agency_read';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'FAIL: policy bl_agency_read missing';
  END IF;

  IF position('trip_agencies' IN lower(v_qual)) = 0 THEN
    RAISE EXCEPTION 'FAIL: bl_agency_read does not reference trip_agencies';
  END IF;

  IF position('auth_app_agency_id' IN lower(v_qual)) = 0 THEN
    RAISE EXCEPTION 'FAIL: bl_agency_read must use private.auth_app_agency_id';
  END IF;

  IF position('user_metadata' IN lower(v_qual)) > 0
     OR position('auth.jwt' IN lower(v_qual)) > 0 THEN
    RAISE EXCEPTION 'FAIL: bl_agency_read must not use auth.jwt / user_metadata';
  END IF;

  RAISE NOTICE 'PASS: bl_agency_read allows trip_agencies operational read';
END $$;

SELECT
  'AUD-020.12 bl_agency_read' AS check_name,
  'PASS' AS status,
  'boarding_logs SELECT includes trip_agencies path' AS detail;

SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'boarding_logs'
  AND policyname = 'bl_agency_read';
