-- ============================================================
-- 040_harden_password_resets.sql
-- SEC-004 / C2 — Harden public.password_resets
--
-- Objetivo: deny-all para clientes (anon/authenticated).
-- Acceso exclusivo vía backend con service_role (supabaseAdmin).
--
-- NO crea policies para anon/authenticated.
-- NO modifica otras tablas ni RLS existente.
-- ============================================================

-- 1) Revocar acceso cliente (defensa en profundidad; idempotente)
REVOKE ALL ON TABLE public.password_resets FROM anon;
REVOKE ALL ON TABLE public.password_resets FROM authenticated;

-- Revocar herencia vía PUBLIC si existiera grant implícito
REVOKE ALL ON TABLE public.password_resets FROM PUBLIC;

-- 2) Activar RLS sin policies → deny-all para roles sin BYPASSRLS
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Validación post-migración (ejecutar en SQL Editor)
-- ============================================================
--
-- -- b) RLS habilitada
-- SELECT relname, relrowsecurity, relforcerowsecurity
-- FROM pg_class
-- WHERE relname = 'password_resets';
-- -- Esperado: relrowsecurity = true
--
-- -- c) Sin grants para clientes
-- SELECT grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name = 'password_resets'
--   AND grantee IN ('anon', 'authenticated', 'PUBLIC');
-- -- Esperado: 0 filas
--
-- -- Caso 1/2: cliente no puede leer
-- BEGIN;
-- SET LOCAL role authenticated;
-- SELECT count(*) FROM public.password_resets;
-- ROLLBACK;
-- -- Esperado: permission denied o 0 rows (sin acceso)
--
-- -- Caso 3: service_role / postgres sigue con acceso (backend)
-- SELECT count(*) FROM public.password_resets;
-- -- Esperado: query OK (como postgres en SQL Editor)
--
-- -- Caso 4: flujo forgot/reset password vía API Express — manual
