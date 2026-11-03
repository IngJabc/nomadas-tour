-- ============================================================
-- 097_trip_completed_at.sql
-- REV-001 — Marca de tiempo fiable de finalizacion de viaje.
--
-- Contexto:
--   REV-001 (reseñas de clientes) abre una ventana de 48 h contada
--   desde la finalizacion EFECTIVA del viaje. Ningun path de
--   completion escribia ese instante:
--     * set_trip_status (065) y complete_trip (057) hacen
--       UPDATE trips SET status='completed' sin columna temporal.
--     * completeExpiredTrips (worker) usa complete_trip (outbox) o
--       un UPDATE directo (legacy). Ninguno estampa completion.
--   updated_at (trigger 052) NO sirve: se mueve con CUALQUIER
--   update del viaje (postergacion, edicion, publicacion 095), no
--   solo con la transicion a completado. Usarlo fabricaria ventanas.
--
-- Cambio:
--   trips.completed_at TIMESTAMPTZ NULL + trigger BEFORE UPDATE que
--   lo fija EXACTAMENTE UNA vez, solo en la transicion
--   status: active|cancelled -> completed. Cualquier update posterior
--   preserva el valor original (no se sobreescribe). 'archived' es un
--   estado TERMINAL (057 archive_trip permite completed -> archived):
--   archivar NO borra la marca, o la ventana de reseña del cliente
--   moriria por una accion rutinaria de ops. Solo se limpia al
--   REABRIR (completed -> active/cancelled). Cobertura total:
--   como el trigger vive en la propia tabla, cubre el RPC manual
--   (set_trip_status), el RPC complete_trip (manual/automatico), el
--   RPC archive_trip y el UPDATE directo del worker legacy, sin tocar
--   esos caminos.
--
--   NO se hace backfill: los viajes completados historicamente quedan
--   con completed_at NULL a proposito (no se fabrican timestamps; la
--   ventana de REV-001 solo aplica a completions futuras).
--
--   El trigger NO altera el comportamiento de outbox, notificaciones,
--   auditoria ni validaciones existentes: solo estampa la columna.
--
-- Dry-run:   BEGIN;  \i 097_trip_completed_at.sql   ROLLBACK;
-- ============================================================

-- 1) Columna. Idempotente y segura si ya existe.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.trips.completed_at IS
  'REV-001: instante EFECTIVO en que el viaje transiciono a status=completed. Fijado una sola vez por el trigger trg_trips_set_completed_at y nunca sobreescribe. NULL en viajes todavia activos/cancelados y en completions historicas (sin backfill). Base de la ventana de reseñas de 48 h.';

-- 2) Indice para la reconciliation de invitaciones (viajes completados
--    dentro de la ventana) y para consultas por estado.
CREATE INDEX IF NOT EXISTS idx_trips_status_completed_at
  ON public.trips (status, completed_at)
  WHERE completed_at IS NOT NULL;

-- 3) Trigger: estampa completed_at SOLO en la transicion a completado.
--    Idempotente: si el viaje ya estaba completado, conserva el valor
--    original (NEW.completed_at := OLD.completed_at) aunque un UPDATE
--    posterior intente cambiarlo.
CREATE OR REPLACE FUNCTION public.trips_set_completed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    -- Transicion hacia completed: estampa la primera vez.
    NEW.completed_at := NOW();
  ELSIF NEW.status IN ('completed', 'archived') THEN
    -- Ya completado (o archivado desde completed/cancelled): preserva
    -- el instante original. Archivar es TERMINAL (057 archive_trip
    -- acepta completed -> archived) y jamas debe borrar la marca:
    -- la ventana de reseña de 48 h sobrevive al archivo.
    NEW.completed_at := OLD.completed_at;
  ELSE
    -- Viaje que REABRE (vuelve a active/cancelled): limpia la marca
    -- para no arrastrar una ventana obsoleta.
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trips_set_completed_at ON public.trips;

CREATE TRIGGER trg_trips_set_completed_at
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.trips_set_completed_at();

COMMENT ON FUNCTION public.trips_set_completed_at() IS
  'REV-001: fija trips.completed_at exactamente una vez, solo en la transicion a status=completed. Cubre set_trip_status, complete_trip (manual/auto), archive_trip (preserva: archived es terminal) y el UPDATE directo del worker. Preserva el valor en updates posteriores; lo limpia solo al reabrir (active/cancelled). SECURITY INVOKER (trigger); no toca outbox ni auditoria.';
