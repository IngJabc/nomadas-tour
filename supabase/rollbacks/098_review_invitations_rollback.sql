-- ============================================================
-- 098_review_invitations_rollback.sql
-- Rollback de la migracion 098 (REV-001 — invitaciones de reseña).
-- Ejecutar SOLO si 098 causa problemas en staging/prod.
--
-- ORDEN: rollback en orden INVERSO al de aplicacion: 099 -> 098 -> 097.
-- No ejecutar este rollback mientras 099 siga aplicada (098 crea las
-- tablas que la RPC de 099 consulta en tiempo de ejecucion).
--
-- Restaura el estado previo:
--   - Elimina las funciones y policies de review_requests y
--     customer_notifications.
--   - Elimina las tablas review_requests y customer_notifications
--     (DROP TABLE IF EXISTS): operacion idempotente.
--   - Elimina los UNIQUE habilitadores de FK compuesta sobre
--     reservations (aditivos en 098; sin ellos el backend pierde la
--     coherencia por esquema reservation+trip+customer+agency).
--
-- IMPORTANTE — perdida de datos (informativo):
--   DROP TABLE ELIMINA todas las invitaciones de reseña y las
--   notificaciones internas de cliente persistidas. Si se necesita
--   conservarlas, exportarlas antes (consulta informativa, a mano):
--     SELECT * FROM public.review_requests;
--     SELECT * FROM public.customer_notifications;
--
-- IMPORTANTE — el rollback NO toca:
--   - reservations (salvo los 3 UNIQUE), trips, pasajeros, pagos,
--     asientos, tickets QR ni abordaje.
--   - trip_reviews/agency_reviews ni el resto de REV-001 (099).
--
-- Efecto en la app (deploy coordinado):
--   El backend de Marketplace (review.service) lee/invoca estas
--   tablas y la RPC generate_review_requests. Con ellas eliminadas y
--   ese backend desplegado, /account/reviews y el loop de
--   reconciliation fallan. Revertir PRIMERO el deploy del Marketplace
--   (o desplegar backend + rollback juntos).
-- ============================================================

-- 1) Functions (idempotente).
DROP FUNCTION IF EXISTS public.generate_review_requests();

-- 2) Policies + tablas (DROP TABLE elimina sus policies en cascada;
--    se limpian explicitas por claridad).
DROP POLICY IF EXISTS "review_requests_customer_read" ON public.review_requests;
DROP POLICY IF EXISTS "review_requests_superadmin_read" ON public.review_requests;
DROP POLICY IF EXISTS "customer_notifications_customer_read" ON public.customer_notifications;
DROP POLICY IF EXISTS "customer_notifications_customer_update" ON public.customer_notifications;
DROP POLICY IF EXISTS "customer_notifications_superadmin_read" ON public.customer_notifications;

DROP TABLE IF EXISTS public.review_requests;
DROP TABLE IF EXISTS public.customer_notifications;

-- 3) UNIQUE habilitadores de FK compuesta sobre reservations.
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_id_trip_id_unique;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_id_customer_id_unique;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_id_agency_id_unique;
