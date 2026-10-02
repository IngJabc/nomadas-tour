-- ============================================================
-- 074_add_customer_role.sql
-- Habilita el rol `customer` en public.users para Nomadas Marketplace.
--
-- Contexto:
--   011_create_all.sql creo public.users con
--     role TEXT NOT NULL CHECK (role IN ('superadmin', 'agency'))
--   y el constraint quedo con nombre autogenerado por Postgres.
--
-- Por que es urgente:
--   El endpoint POST /api/auth/register del backend marketplace
--   (nomadas-tour-marketplace) ya inserta role='customer'.
--   Sin esta migracion ese insert falla por violacion del CHECK.
--
-- Migracion marketplace 1 de 6 (074-079).
-- Fuente de verdad: nomadas-tour-marketplace/docs/business-rules.md seccion 1.
--
-- Dry-run:   BEGIN;  \i 074_add_customer_role.sql   ROLLBACK;
-- Regresion: eliminar las filas role='customer' y volver el CHECK a
--            ('superadmin', 'agency').
-- ============================================================

-- 1) DROP de todo CHECK de public.users que restrinja `role`.
--    Se resuelve por catalogo (no por nombre) porque 011 no lo nombro.
--    Es idempotente: si users_role_check ya existe, tambien cae aqui.
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'users'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', v_name);
  END LOOP;
END
$$;

-- 2) CHECK nuevo, con nombre explicito para futuras migraciones
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin', 'agency', 'customer'));

-- 3) Documentacion del contrato
COMMENT ON CONSTRAINT users_role_check ON public.users IS
  'Roles: superadmin | agency (operacion nomadas-tour) | customer (Nomadas Marketplace, 074+).';

COMMENT ON COLUMN public.users.role IS
  'Identidad de app. customer solo existe desde la migracion 074 (marketplace).';