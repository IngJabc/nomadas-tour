-- ============================================================
-- 095_trip_marketplace_publication.sql
-- TRIP-PUB-001 -- Control de publicacion de viajes en el Marketplace.
--
-- Contexto:
--   El Marketplace filtraba la visibilidad publica de un viaje unicamente
--   por trips.status='active' (catalogo, detalle y bloqueo de asientos).
--   Para ocultar un viaje del storefront sin cancelarlo, la unica palanca
--   era cambiar su estado operativo, lo que afectaria el ciclo de vida que
--   gestiona nomadas-tour (reservas, pasajeros, pagos, abordaje).
--
-- Cambio:
--   trips.is_published BOOLEAN NOT NULL DEFAULT true. Columna INDEPENDIENTE
--   del estado operativo: publicar o despublicar un viaje NUNCA modifica
--   trips.status ni toca reservations, reservation_passengers, seats,
--   payments, payment_allocations ni QR/tickets.
--
--   DEFAULT true + NOT NULL: todos los viajes existentes quedan publicados
--   sin backfill (mismo patron que 078). NO se agregan triggers ni tablas
--   (public.trips tambien lo escribe nomadas-tour).
--
-- Consumidores (Marketplace, fuera de esta migracion):
--   - GET /api/public/trips y GET /api/public/trips/:id filtran
--     is_published = true (el detalle responde 404 TRIP_NOT_FOUND).
--   - Seat locks (autenticado y guest) y create_checkout_attempt rechazan
--     viajes no publicados con 409 antes de crear locks o intento.
--   - Reservas, verificacion de pago, tickets y abordaje existentes NO
--     filtran por is_published: seguiran funcionando con el viaje oculto.
--
-- Dry-run:   BEGIN;  \i 095_trip_marketplace_publication.sql   ROLLBACK;
--
-- NOTA de despliegue: la columna debe existir ANTES de desplegar el backend
-- que la filtra (PostgREST responde error si la columna referenciada no
-- existe en la tabla). Aplicar esta migracion primero, despues el deploy.
-- ============================================================

-- 1) Bandera de publicacion en el Marketplace (visibilidad, NO estado).
--    false = el viaje no se lista ni se puede reservar desde el
--    Marketplace; sigue visible y operable en nomadas-tour.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.trips.is_published IS
  'Visibilidad en el Marketplace. NO es el estado operativo (status lo gestiona nomadas-tour). false = el viaje no aparece en el catalogo publico, su detalle responde 404 y el Marketplace rechaza nuevos locks/checkout; reservas, pagos, tickets y abordaje existentes no se ven afectados.';
