-- ============================================================
-- Sprint 20 — Agrega trip_agencies a la publicación Realtime
-- y añade columna created_at para tracking de actividad.
-- Permite que el dashboard de agencia reaccione cuando
-- el superadmin asigna un viaje a la agencia.
-- ============================================================

ALTER TABLE trip_agencies ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER PUBLICATION supabase_realtime ADD TABLE trip_agencies;
