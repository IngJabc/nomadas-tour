-- ============================================================
-- 093_checkout_realtime.sql
-- RT-04A — Realtime de pagos/compras para el cliente autenticado.
--
-- Objetivo: el cliente puede suscribirse a cambios de SUS propias
-- compras en el Marketplace (historial /cuenta/compras y boleto QR)
-- sin polling. Tablas objetivo:
--   - checkout_attempts: origen del estado de cada compra.
--     Faltaba estar en la publicacion y el cliente no tenia GRANT
--     de lectura (087 revoco todo hacia authenticated/anon).
--   - payments: transiciones de pago (flujo 083/085 y verify 087).
--     Ya tenia policy de cliente desde 076 pero NO estaba en la
--     publicacion, asi que jamas llegaba un evento.
--   - reservations: ya estaba en publicacion (006/012) con policy
--     customer_read (075); no requiere cambios.
--
-- Seguridad (invariantes):
--   - NO se elimina ni toca el REVOKE de 087 hacia anon: anon
--     sigue SIN SELECT sobre checkout_attempts.
--   - El unico GRANT nuevo es SELECT a authenticated, acotado por
--     RLS a customer_id = auth.uid() (filas propias). Es lectura
--     de realtime, nunca escritura: INSERT/UPDATE/DELETE siguen
--     siendo exclusivos de service_role / RPCs.
--   - NO modifica locks, TTL, estados de asientos, flujos de
--     verificacion/rechazo ni el contrato del boleto QR.
--   - Las incorporaciones a supabase_realtime usan guarda explicita sobre
--     el catalogo de publicaciones: el archivo es reejecutable y no
--     depende de IF NOT EXISTS (no existe en ALTER PUBLICATION de PG 17).
--   - NO aplica la migracion: solo se crea el archivo local.
-- ============================================================

-- 1) Lectura de checkout_attempts para el cliente autenticado.
--    087 dejo: REVOKE ALL ... FROM PUBLIC/anon/authenticated +
--    GRANT ... TO service_role. Aqui se habilita UNICAMENTE el
--    SELECT de authenticated; los REVOKE de anon y las escrituras
--    service_role permanecen tal cual.
GRANT SELECT ON TABLE public.checkout_attempts TO authenticated;

-- 2) RLS: solo las filas del propio cliente son visibles (y por lo
--    tanto sus eventos Realtime via postgres_changes).
DROP POLICY IF EXISTS checkout_attempts_customer_read ON public.checkout_attempts;
CREATE POLICY checkout_attempts_customer_read ON public.checkout_attempts
  FOR SELECT
  USING (customer_id = auth.uid());

COMMENT ON POLICY checkout_attempts_customer_read ON public.checkout_attempts IS
  'RT-04A: el cliente autenticado lee (y recibe eventos Realtime de) solo sus checkout_attempts. Sin acceso anon; escritura exclusiva service_role.';

-- 3) Publicacion Realtime. Sin esto Supabase Realtime no entrega
--    eventos de las tablas aunque exista policy.
--
--    Guarda de idempotencia sobre el catalogo: PostgreSQL 17 (version del
--    proyecto) NO admite `ADD TABLE IF NOT EXISTS` en ALTER PUBLICATION
--    (sinopsis oficial de PG 17; misma razon que obligo a remediar
--    010_drop_all.sql con el DROP plano). Una reejecucion del archivo
--    fallaria con "already a member of publication" si la tabla ya esta
--    incorporada. Se consulta pg_publication_tables (vista usada ya por
--    supabase/tests) y el ADD solo se ejecuta si la tabla falta.
--    El pipeline de Supabase CLI aplica cada migracion una sola vez
--    (historial propio), pero el SQL tambien se ejecuta a mano en el SQL
--    Editor ante incidentes (ver supabase/rollbacks/README.md) o tras
--    restauraciones: ahi la guarda evita el fallo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'checkout_attempts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.checkout_attempts;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
  END IF;
END $$;
