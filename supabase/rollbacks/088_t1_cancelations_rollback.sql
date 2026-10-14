-- 088_t1_cancelations_rollback.sql
-- Rollback para migración 088 MKT-008 (T-1 cancelación por pasajero)
-- Ejecutar SOLO si la migración 088 causa problemas en staging/prod.
-- Orden inverso de creación: triggers → functions → index.

DROP TRIGGER IF EXISTS ca_expired_emit_outbox_t ON public.checkout_attempts;
DROP TRIGGER IF EXISTS rp_cancelled_recalc_payment_t ON public.reservation_passengers;

DROP FUNCTION IF EXISTS public.trg_ca_expired_emit_outbox();
DROP FUNCTION IF EXISTS public.trg_rp_cancelled_recalc_payment();
DROP FUNCTION IF EXISTS public.schedule_marketplace_t1_cancellations(INTEGER);
DROP FUNCTION IF EXISTS public.recalculate_reservation_payment_status(UUID);

DROP INDEX IF EXISTS public.uq_outbox_checkout_expired;
