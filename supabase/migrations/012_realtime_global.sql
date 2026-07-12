-- ============================================================
-- Sprint 12 — Realtime Global Synchronization
-- ============================================================
-- Agrega más tablas a la publicación supabase_realtime
-- para que Supabase Realtime pueda emitir sus cambios.
-- ============================================================

-- 1. Agregar reservations a la publicación
ALTER PUBLICATION supabase_realtime ADD TABLE reservations;

-- 2. Agregar trips a la publicación (para ver cambios de estado/completado)
ALTER PUBLICATION supabase_realtime ADD TABLE trips;

-- 3. Agregar reservation_passengers a la publicación (para boarding en vivo)
ALTER PUBLICATION supabase_realtime ADD TABLE reservation_passengers;
