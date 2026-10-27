-- ============================================================
-- 094_agency_payments_realtime.sql
-- RT-06 — Realtime de pagos/compras para el módulo de agencia.
--
-- Objetivo: la agencia autenticada puede suscribirse a cambios de
-- SUS pagos y SUS compras (checkout_attempts) desde
-- /agency/payments, su listado de detalle y su detalle de compra,
-- sin polling. Tablas objetivo:
--   - checkout_attempts: origen del estado de cada compra
--     (panel de revisión MKT-007). 087 revoco SELECT hacia
--     authenticated y 093 lo restauro para el cliente; aqui se
--     agrega la policy de LECTURA de la agencia dueña.
--   - payments: transiciones de pago del flujo legacy (083/085)
--     y del verify (076/087). Ya tenia policy de cliente (076)
--     pero ninguna de agencia, y su GRANT default hacia
--     authenticated nunca fue revocado.
--
-- Seguridad (invariantes):
--   - Las policies son ESPEJO del backend: /api/agency monta
--     `auth, authorize('agency'), tenant` (superadmin excluido) y
--     los controllers exigen req.ctx.agencyId, asi que aqui solo
--     role='agency' con agency_id = la propia. La autorizacion de
--     fila nunca depende del filtro del canal realtime (el filtro
--     agency_id=eq.* del cliente es solo rendimiento; RLS es la
--     autoridad).
--   - NO se elimina ni toca la policy de cliente de 076/093, ni
--     los REVOKE hacia anon de 087, ni escrituras (siguen siendo
--     service_role / RPCs).
--   - NO modifica RPCs de verificacion/rechazo, estados de compra,
--     TTLs (900s marketplace / 600s tour), locks, flujos de
--     abordaje ni el contrato del boleto QR.
--   - Las incorporaciones a supabase_realtime usan la MISMA guarda
--     explicita sobre el catalogo que 093 (PG17 no admite
--     IF NOT EXISTS en ALTER PUBLICATION): el archivo es
--     reejecutable y, si 093 ya corrio, el bloque no hace nada.
--     Se incluye aqui para que RT-06 sea auto-suficiente aunque
--     093 (serie RT-04A) no se haya aplicado aun.
--   - NO aplica la migracion: solo se crea el archivo local.
-- ============================================================

-- 1) Lectura de checkout_attempts para la agencia autenticada.
--    087 dejo un REVOKE total hacia authenticated y el unico GRANT
--    de SELECT vivo es el de 093 (cliente). Se reafirma aqui (el
--    GRANT es idempotente y no debilita nada: la policy del paso 2
--    acota las filas) para que RT-06 no dependa de que 093 se haya
--    aplicado. Para `payments` no hace falta grant: nunca fue
--    revocado desde su creacion (076) y los privilegios default de
--    Supabase ya incluyen SELECT a authenticated.
GRANT SELECT ON TABLE public.checkout_attempts TO authenticated;

-- 2) RLS checkout_attempts: solo filas de la propia agencia.
--    Patron 039 (helpers private.auth_app_role / auth_app_agency_id).
DROP POLICY IF EXISTS checkout_attempts_agency_read ON public.checkout_attempts;
CREATE POLICY checkout_attempts_agency_read ON public.checkout_attempts
  FOR SELECT
  USING (
    (SELECT private.auth_app_role()) = 'agency'
    AND agency_id = (SELECT private.auth_app_agency_id())
  );

COMMENT ON POLICY checkout_attempts_agency_read ON public.checkout_attempts IS
  'RT-06: la agencia autenticada lee (y recibe eventos Realtime de) solo sus checkout_attempts. Espejo de authorize(agency) del backend; escritura exclusiva service_role.';

-- 3) RLS payments: solo filas de la propia agencia.
DROP POLICY IF EXISTS payments_agency_read ON public.payments;
CREATE POLICY payments_agency_read ON public.payments
  FOR SELECT
  USING (
    (SELECT private.auth_app_role()) = 'agency'
    AND agency_id = (SELECT private.auth_app_agency_id())
  );

COMMENT ON POLICY payments_agency_read ON public.payments IS
  'RT-06: la agencia autenticada lee (y recibe eventos Realtime de) solo sus payments. Coexiste con payments_customer_read (076); escritura exclusiva service_role.';

-- 4) Publicacion Realtime. Sin esto Supabase Realtime no entrega
--    eventos de las tablas aunque exista policy.
--
--    Misma guarda de idempotencia que 093 (comentario completo ahi):
--    PostgreSQL 17 NO admite `ADD TABLE IF NOT EXISTS` en ALTER
--    PUBLICATION, y esta clausula se ejecuta tambien a mano en el
--    SQL Editor ante incidentes (ver supabase/rollbacks/README.md).
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
