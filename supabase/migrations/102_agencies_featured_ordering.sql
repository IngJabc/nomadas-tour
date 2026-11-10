-- ============================================================
-- 102_agencies_featured_ordering.sql
-- REP-001 — Destacados y orden manual de agencias en el
-- directorio publico del Marketplace.
--
-- Contexto:
--   El directorio publico (/api/public/agencies) necesita una
--   forma PERSISTENTE y editable por superadmin de decidir que
--   agencias aparecen primero. Sin estas columnas el orden seria
--   aleatorio (o dependiente de insertion), es decir: no editable.
--
-- Por que una migracion nueva:
--   006/011 definen agencies (id, name, subdomain, email, phone,
--   status) y son historicas y ya aplicadas en el proyecto
--   Supabase compartido: se leen, no se reescriben (SEC-009.3-SP1).
--   El patron ya usado (041, 091, 095, 101) es ADD COLUMN IF NOT
--   EXISTS aditivo: NADA se quita ni se reordena.
--
-- Que agrega (solo lo necesario):
--   agencies.is_featured    BOOLEAN NOT NULL DEFAULT false
--   agencies.featured_order INTEGER NOT NULL DEFAULT 0 (>= 0)
--   + indice parcial para el ORDER BY del directorio.
--
-- Que NO se toca:
--   - name, subdomain, email, phone, status ni ninguna otra
--     columna de agencies.
--   - agency_settings (041, branding), agency_contacts (091),
--     agency_payment_methods (089) ni trip_agencies (011).
--   - RLS, policies, GRANT/REVOKE: las columnas se leen desde el
--     backend del Marketplace con service_role (bypass RLS), igual
--     que el resto del directorio.
--   - Ninguna otra tabla, RPC, indice ni constraint.
--
-- Semantica:
--   is_featured  = el superadmin la muestra como destacada.
--   featured_order= orden ASCENTENTE entre destacadas (0 = sin
--                  posicion asignada). Al QUITAR el destacado el
--                  backend lo resetea a 0 para que no quede un
--                  valor huerfano.
--   El directorio ordena: is_featured DESC, featured_order ASC,
--   name ASC (desempate estable y determinista).
--
-- Dry-run:   BEGIN;  \i 102_agencies_featured_ordering.sql   ROLLBACK;
-- Requiere:  ninguna (aditiva sobre 006/011). No depende de 097-099.
-- ============================================================

-- ============================================================
-- 1) Columnas — aditivas e idempotentes
-- ============================================================

-- 1a) Destacado manual. DEFAULT false: ninguna agencia existente
--     cambia de conducta al aplicar la migracion.
ALTER TABLE public.agencies
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

-- 1b) Orden manual entre destacadas. CHECK inline: si la columna
--     ya existiera (re-ejecucion) el ALTER se omite por IF NOT
--     EXISTS y no se duplica el constraint.
ALTER TABLE public.agencies
  ADD COLUMN IF NOT EXISTS featured_order INTEGER NOT NULL DEFAULT 0
  CONSTRAINT agencies_featured_order_check CHECK (featured_order >= 0);

-- ============================================================
-- 2) Indice para el ORDER BY del directorio
-- ============================================================
-- Parcial sobre agencias activas: el directorio PUBLICO solo
-- muestra status='active', asi que el indice no gasta espacio con
-- agencias inactivas. Cubre el orden completo
-- (is_featured DESC, featured_order ASC, name ASC) para que el
-- listado no necesite un sort en memoria.
CREATE INDEX IF NOT EXISTS idx_agencies_featured_ordering
  ON public.agencies (is_featured DESC, featured_order ASC, name ASC)
  WHERE status = 'active';

-- ============================================================
-- 3) Comentarios (trazabilidad en schema)
-- ============================================================
COMMENT ON COLUMN public.agencies.is_featured IS
  'REP-001 (102): true cuando el superadmin destaca la agencia en el directorio publico del Marketplace. Default false; la edita PATCH /api/admin/agencies/:agencyId.';

COMMENT ON COLUMN public.agencies.featured_order IS
  'REP-001 (102): posicion ASCENTENTE entre agencias destacadas (0 = sin posicion). El directorio ordena is_featured DESC, featured_order ASC, name ASC. Se resetea a 0 al quitar el destacado.';

COMMENT ON INDEX public.idx_agencies_featured_ordering IS
  'REP-001 (102): orden del directorio publico de agencias (solo activas).';
