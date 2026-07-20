-- ============================================================
-- 027_agencies_own_read_realtime.sql
-- Permite que usuarios agency reciban eventos Realtime
-- de su propia agencia, incluyendo cambios de status a inactive.
--
-- Sin esta policy, la subscription postgres_changes en
-- agency/layout.tsx no entrega eventos UPDATE cuando
-- agencies.status cambia, porque agencies_public_read
-- solo permite SELECT de agencias activas.
-- ============================================================

CREATE POLICY "agencies_own_read" ON agencies
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );
