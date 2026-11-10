-- ============================================================
-- 102_agencies_featured_ordering_rollback.sql
-- Rollback de la migracion 102 (REP-001 — destacados y orden
-- de agencias en el directorio publico).
-- Ejecutar SOLO si 102 causa problemas en staging/prod.
--
-- Restaura el estado previo:
--   - Elimina el indice idx_agencies_featured_ordering.
--   - Elimina las columnas public.agencies.featured_order e
--     is_featured con DROP COLUMN IF EXISTS: operacion
--     idempotente y reejecutable.
--
-- IMPORTANTE — perdida de datos (informativo):
--   El DROP COLUMN ELIMINA el destacado y el orden manual de
--   TODAS las agencias. Esos dos valores solo existen para el
--   directorio del Marketplace (102): no hay otra fuente. Si se
--   necesitan conservar, exportarlos ANTES del rollback
--   (consulta informativa, a mano):
--     SELECT id, name, is_featured, featured_order
--       FROM public.agencies WHERE is_featured = true OR featured_order <> 0;
--   Tras el rollback, el directorio vuelve al orden por defecto
--   (is_featured DESC ya no existe: ordena por nombre) y el
--   endpoint PATCH /api/admin/agencies/:agencyId dejara de
--   funcionar (las columnas ya no estan).
--
-- IMPORTANTE — el rollback NO toca:
--   - name, subdomain, email, phone, status ni ninguna otra
--     columna de agencies.
--   - agency_settings (041), agency_contacts (091),
--     agency_payment_methods (089) ni trip_agencies (011).
--   - RLS, policies, GRANT/REVOKE ni otras tablas.
--
-- Dry-run: BEGIN;  \i 102_agencies_featured_ordering_rollback.sql  ROLLBACK;
-- ============================================================

DROP INDEX IF EXISTS public.idx_agencies_featured_ordering;

ALTER TABLE public.agencies DROP COLUMN IF EXISTS featured_order;
ALTER TABLE public.agencies DROP COLUMN IF EXISTS is_featured;
