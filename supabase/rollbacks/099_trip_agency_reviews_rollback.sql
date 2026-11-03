-- ============================================================
-- 099_trip_agency_reviews_rollback.sql
-- Rollback de la migracion 099 (REV-001 — reseñas de viaje/agencia).
-- Ejecutar SOLO si 099 causa problemas en staging/prod.
--
-- Restaura el estado previo:
--   - Elimina las funciones submit_reservation_reviews y
--     moderate_review.
--   - Elimina las tablas trip_reviews y agency_reviews
--     (DROP TABLE IF EXISTS): operacion idempotente.
--   - Restaura los CHECK de audit_log a su estado previo a 099 (29
--     acciones / 10 entidades de 065+069+079+086+087+089+091). Se
--     QUITAN los valores que 099 agrego (review.created/review.moderated
--     y trip_review/agency_review): este rollback es la unica operacion
--     que los elimina a proposito.
--
-- IMPORTANTE — perdida de datos (informativo):
--   DROP TABLE ELIMINA todas las reseñas de viaje y de agencia
--   persistidas (contenido + estados de moderacion). La auditoria en
--   audit_log NO se toca (append-only) y se conserva. Si se necesita
--   conservar las reseñas, exportarlas antes (a mano):
--     SELECT * FROM public.trip_reviews;
--     SELECT * FROM public.agency_reviews;
--
-- IMPORTANTE — el rollback NO toca:
--   - reservations, trips (097), review_requests ni
--     customer_notifications (098): siguen vivos. Revocar tambien
--     098/097 si se desea eliminar todo REV-001 (en orden inverso).
--   - El resto de CHECK de audit_log (solo se retiran los valores de
--     099). El actor_check (con 'customer') NO se toca.
--
-- Efecto en la app (deploy coordinado):
--   El backend de Marketplace (review.service) y el panel de
--   moderacion usan estas tablas y RPCs. Con ellas eliminadas y ese
--   backend desplegado, el envío de reseñas y la moderacion fallan.
--   Revertir PRIMERO el deploy del Marketplace (o desplegar backend +
--   rollback juntos).
-- ============================================================

-- 1) Functions (idempotente).
DROP FUNCTION IF EXISTS public.submit_reservation_reviews(UUID, UUID, INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.moderate_review(TEXT, UUID, TEXT, UUID, TEXT);

-- 2) Policies + tablas (DROP TABLE elimina policies en cascada; se
--    limpian explicitas por claridad).
DROP POLICY IF EXISTS "trip_reviews_customer_read" ON public.trip_reviews;
DROP POLICY IF EXISTS "trip_reviews_public_visible_read" ON public.trip_reviews;
DROP POLICY IF EXISTS "trip_reviews_superadmin_all" ON public.trip_reviews;
DROP POLICY IF EXISTS "agency_reviews_customer_read" ON public.agency_reviews;
DROP POLICY IF EXISTS "agency_reviews_public_visible_read" ON public.agency_reviews;
DROP POLICY IF EXISTS "agency_reviews_superadmin_all" ON public.agency_reviews;

DROP TABLE IF EXISTS public.trip_reviews;
DROP TABLE IF EXISTS public.agency_reviews;

-- 3) Restaurar CHECK de audit_log al estado previo a 099 (sin los
--    valores de review). Se elimina el constraint vigente (el de 099)
--    y se recrea la lista VIVA de 091 (29 acciones / 10 entidades:
--    087 + 089 agency_payment_method + 091 agency_contact).
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_action_check CHECK (
    action IN (
      'trip.created',
      'trip.updated',
      'trip.cancelled',
      'reservation.created',
      'reservation.cancelled',
      'boarding.board',
      'boarding.unboard',
      'agency_settings.updated',
      'notification_preferences.updated',
      'reservation_link.created',
      'reservation_link.cancelled',
      'reservation_link.confirmed',
      'reservation_link.regenerated',
      'reservation_link.passenger_data_saved',
      'reservation_link.expired',
      'reservation.passenger_cancelled',
      'payment.verified',
      'payment.rejected',
      'checkout.verified',
      'checkout.rejected',
      'checkout.expired',
      'checkout.cancelled',
      'agency_payment_method.created',
      'agency_payment_method.updated',
      'agency_payment_method.primary_set',
      'agency_payment_method.deleted',
      'agency_contact.created',
      'agency_contact.updated',
      'agency_contact.deleted'
    )
  );

COMMENT ON CONSTRAINT audit_log_action_check ON public.audit_log IS
  '065 + 069 + 079 (16) + 086 payment (2) + 087 checkout (4) + 089 agency_payment_method (4) + 091 agency_contact (3). Aditivo: no quitar valores.';

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_type_check CHECK (
    entity_type IN (
      'trip',
      'reservation',
      'reservation_passenger',
      'agency_settings',
      'notification_preferences',
      'reservation_link',
      'payment',
      'checkout_attempt',
      'agency_payment_method',
      'agency_contact'
    )
  );

COMMENT ON CONSTRAINT audit_log_entity_type_check ON public.audit_log IS
  '065 + 069 (6) + 086 payment (1) + 087 checkout_attempt (1) + 089 agency_payment_method (1) + 091 agency_contact (1). Aditivo: no quitar valores.';
