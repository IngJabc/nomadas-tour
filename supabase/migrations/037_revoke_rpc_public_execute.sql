-- ============================================================
-- 037_revoke_rpc_public_execute.sql
-- FASE 1 — Security Hardening Sprint (SEC-002 / C3)
--
-- Restringe funciones SECURITY DEFINER a service_role únicamente.
-- El backend invoca create_agency_reservation vía supabaseAdmin (service-role).
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.create_agency_reservation(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID[],
  TEXT[],
  TEXT[],
  TEXT[]
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.create_agency_reservation(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID[],
  TEXT[],
  TEXT[],
  TEXT[]
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.create_agency_reservation(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID[],
  TEXT[],
  TEXT[],
  TEXT[]
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.create_agency_reservation(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID[],
  TEXT[],
  TEXT[],
  TEXT[]
) TO service_role;

-- create_superadmin es un placeholder vacío (006_multi_tenant_schema.sql).
-- Revocar ejecución pública y eliminar la función (si existe).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'create_superadmin' AND n.nspname = 'public'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.create_superadmin(TEXT, TEXT, TEXT) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.create_superadmin(TEXT, TEXT, TEXT) FROM anon;
    REVOKE EXECUTE ON FUNCTION public.create_superadmin(TEXT, TEXT, TEXT) FROM authenticated;
    DROP FUNCTION public.create_superadmin(TEXT, TEXT, TEXT);
  END IF;
END $$;
