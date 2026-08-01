-- ============================================================
-- 035_backfill_users_from_auth.sql
-- FASE 0 — Security Hardening Sprint (SEC-001)
--
-- Objetivo: garantizar que cada auth.users con identidad de app
-- tenga fila correspondiente en public.users antes de cortar
-- la dependencia de user_metadata en autorización.
--
-- Idempotente: solo inserta filas faltantes (ON CONFLICT DO NOTHING).
-- No modifica filas existentes en public.users.
-- ============================================================

INSERT INTO public.users (id, email, password_hash, role, agency_id)
SELECT
  au.id,
  COALESCE(
    NULLIF(trim(au.email), ''),
    concat(au.id::text, '@identity-gap.nomadas.local')
  ),
  '',
  CASE
    WHEN au.raw_user_meta_data->>'role' = 'superadmin' THEN 'superadmin'
    ELSE 'agency'
  END,
  CASE
    WHEN au.raw_user_meta_data->>'role' = 'superadmin' THEN NULL
    ELSE NULLIF(au.raw_user_meta_data->>'agency_id', '')::uuid
  END
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.users u WHERE u.id = au.id
)
AND (
  -- Cuentas con rol explícito en metadata (superadmin o agency)
  au.raw_user_meta_data->>'role' IN ('superadmin', 'agency')
  -- Cuentas agency con agency_id en metadata aunque falte role
  OR NULLIF(au.raw_user_meta_data->>'agency_id', '') IS NOT NULL
);

-- ============================================================
-- Auditoría post-backfill (ejecutar manualmente en SQL Editor)
-- ============================================================
--
-- 1) auth.users sin public.users (debe ser 0 antes de FASE 1
--    para cuentas que deban seguir autenticándose):
--
-- SELECT au.id, au.email, au.raw_user_meta_data
-- FROM auth.users au
-- LEFT JOIN public.users u ON u.id = au.id
-- WHERE u.id IS NULL;
--
-- 2) Desalineación metadata vs public.users (informativo; FASE 1
--    dejará de usar metadata, pero conviene corregir datos):
--
-- SELECT
--   u.id,
--   u.email,
--   u.role AS db_role,
--   au.raw_user_meta_data->>'role' AS meta_role,
--   u.agency_id AS db_agency_id,
--   NULLIF(au.raw_user_meta_data->>'agency_id', '')::uuid AS meta_agency_id
-- FROM public.users u
-- JOIN auth.users au ON au.id = u.id
-- WHERE u.role IS DISTINCT FROM au.raw_user_meta_data->>'role'
--    OR u.agency_id IS DISTINCT FROM NULLIF(au.raw_user_meta_data->>'agency_id', '')::uuid;
--
-- 3) agency sin agency_id en public.users:
--
-- SELECT id, email, role, agency_id
-- FROM public.users
-- WHERE role = 'agency' AND agency_id IS NULL;
--
-- 4) superadmin con agency_id (anomalía):
--
-- SELECT id, email, role, agency_id
-- FROM public.users
-- WHERE role = 'superadmin' AND agency_id IS NOT NULL;
