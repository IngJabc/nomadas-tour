-- ============================================================
-- 093_checkout_realtime_rollback.sql
-- Rollback de la migracion 093 (Realtime de compras RT-04A).
-- Ejecutar SOLO si la migracion 093 causa problemas en staging/prod.
--
-- Restaura el estado previo:
--   - checkout_attempts y payments salen de la publicacion
--     supabase_realtime (dejan de generar eventos), solo si hoy
--     pertenecen a ella (guarda explicita sobre el catalogo).
--   - Se elimina la policy checkout_attempts_customer_read.
--   - Se revierte el GRANT SELECT a authenticated sobre
--     checkout_attempts (vuelve el REVOKE total de 087).
--
-- IMPORTANTE - el rollback NO revierte datos ni toca:
--   - locks/TTL de asientos, estados de compra, pagos, reservas
--     ni boletos QR.
--   - las politicas ni grants de payments/reservations (075/076).
--   - el REVOKE de anon de 087 (nunca fue modificado).
--
-- Efecto en la app: las paginas /cuenta/compras, el boleto y
-- /viajes dejan de recibir actualizaciones en vivo y vuelven al
-- comportamiento de carga unica al montar (fallback existente).
-- ============================================================

-- Salida de la publicacion Realtime con la misma guarda de catalogo que la
-- migracion: PostgreSQL 17 (version del proyecto) NO admite
-- `DROP TABLE IF EXISTS` en ALTER PUBLICATION —por eso 010_drop_all.sql
-- quedo remediado con el DROP plano— y un DROP a ciegas fallaria si la
-- tabla ya no pertenece a la publicacion. pg_publication_tables decide si
-- se ejecuta cada retirada; asi el rollback es reejecutable.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'checkout_attempts'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.checkout_attempts;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.payments;
  END IF;
END $$;

DROP POLICY IF EXISTS checkout_attempts_customer_read ON public.checkout_attempts;

REVOKE SELECT ON TABLE public.checkout_attempts FROM authenticated;
