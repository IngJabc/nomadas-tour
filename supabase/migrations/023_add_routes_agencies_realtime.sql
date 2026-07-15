-- ============================================================
-- Sprint 23 — Agrega routes y agencies a la publicación Realtime.
-- Permite que /admin/routes reaccione a cambios en trips y
-- reservations (recálculo de contadores), y que /admin/agencies
-- reaccione a INSERT y UPDATE en la tabla agencies.
-- Compatible con instalación limpia: usa IF NOT EXISTS.
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE routes;
ALTER PUBLICATION supabase_realtime ADD TABLE agencies;
