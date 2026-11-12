-- ============================================================
-- 105_agency_trip_update_rollback.sql
-- Rollback MANUAL de 105_agency_trip_update.sql (AS-TRIP-004).
-- Nunca lo aplica el pipeline de migraciones: ver rollbacks/README.md.
-- Aplicar solo en SQL Editor con aprobacion explicita.
--
-- Revierte unicamente la funcion nueva. NO toca update_trip (084),
-- set_trip_status (104), el trigger de reservas (104) ni ningun dato:
-- no hay tablas, columnas ni politicas que restaurar. Si la funcion ya
-- no existe, IF EXISTS lo deja en silencio.
-- ============================================================

DROP FUNCTION IF EXISTS public.update_agency_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID, INTEGER);
