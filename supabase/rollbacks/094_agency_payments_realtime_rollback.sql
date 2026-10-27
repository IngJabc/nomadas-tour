-- ============================================================
-- 094_agency_payments_realtime_rollback.sql
-- Rollback de la migracion 094 (Realtime de pagos de agencia RT-06).
-- Ejecutar SOLO si la migracion 094 causa problemas en staging/prod.
--
-- Restaura el estado previo:
--   - Se eliminan las policies checkout_attempts_agency_read y
--     payments_agency_read (la agencia deja de leer/esos eventos).
--
-- NO revierte (compartido con 093 / RT-04A o ya existente):
--   - La pertenencia de checkout_attempts y payments a
--     supabase_realtime: es la MISMA que agrega 093 para el
--     cliente. Retirarla aqui romperia el realtime del historial
--     de compras del marketplace. Si hay que retirarla, usar
--     093_checkout_realtime_rollback.sql (ambas juntas).
--   - El GRANT SELECT a authenticated sobre checkout_attempts:
--     tambien lo usa 093. La policy de cliente de 093 y las de
--     039 siguen acotando las filas visibles.
--   - la policy de cliente de payments (076) ni el REVOKE de anon
--     de 087.
--   - locks/TTL, estados de compra/pago, RPCs de verificacion y
--     rechazo, flujos de abordaje ni boletos QR.
--
-- Efecto en la app: /agency/payments (listado y detalle) deja de
-- recibir actualizaciones en vivo y vuelve a la carga unica al
-- montar; el banner de "Sin actualizaciones en vivo" con
-- actualizacion manual sigue disponible como fallback.
-- ============================================================

DROP POLICY IF EXISTS checkout_attempts_agency_read ON public.checkout_attempts;

DROP POLICY IF EXISTS payments_agency_read ON public.payments;
