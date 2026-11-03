-- ============================================================
-- 097_trip_completed_at_rollback.sql
-- Rollback de la migracion 097 (REV-001 — completed_at de viajes).
-- Ejecutar SOLO si 097 causa problemas en staging/prod.
--
-- Restaura el estado previo:
--   - Elimina el trigger trg_trips_set_completed_at y su funcion.
--   - Elimina la columna public.trips.completed_at con DROP COLUMN
--     IF EXISTS: operacion idempotente y reejecutable.
--
-- IMPORTANTE — perdida de datos (informativo):
--   El DROP COLUMN ELIMINA la marca de completion de TODOS los
--   viajes completados desde 097. La ventana de reseñas de REV-001
--   depende de esa columna: con ella borrada, el backend del
--   Marketplace no puede calcular elegibilidad ni expiracion y las
--   reseñas dejan de funcionar. Antes del rollback, exportar los
--   valores si se necesitan conservar (consulta informativa, a mano):
--     SELECT id, status, completed_at FROM public.trips WHERE completed_at IS NOT NULL;
--
-- IMPORTANTE — el rollback NO toca:
--   - trips.status ni ninguna otra columna: el estado operativo de
--     cada viaje queda intacto.
--   - reservas, pasajeros, pagos, asientos, tickets QR ni abordaje.
--   - outbox, notificaciones ni auditoria existentes.
--
-- Efecto en la app (deploy coordinado):
--   El backend de Marketplace lee trips.completed_at para REV-001.
--   Con la columna eliminada y ese backend desplegado, la generacion
--   de invitaciones y el envio de reseñas fallan. Revertir PRIMERO el
--   deploy del Marketplace (o desplegar backend + rollback juntos);
--   nunca dejar el backend consultando una columna inexistente.
-- ============================================================

-- 1) Eliminar el trigger y su funcion (idempotente).
DROP TRIGGER IF EXISTS trg_trips_set_completed_at ON public.trips;
DROP FUNCTION IF EXISTS public.trips_set_completed_at();

-- 2) Eliminar la columna (idempotente).
ALTER TABLE public.trips DROP COLUMN IF EXISTS completed_at;

-- El indice idx_trips_status_completed_at se elimina en cascada con la
-- columna; se limpia defensivamente por si acaso.
DROP INDEX IF EXISTS public.idx_trips_status_completed_at;
