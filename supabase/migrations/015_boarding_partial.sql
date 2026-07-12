-- ============================================================
-- 015_boarding_partial.sql
-- Agrega estados 'partial' y 'completed' a reservations.status
-- para soportar boarding parcial por QR.
-- ============================================================

ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS reservations_status_check,
  ADD CONSTRAINT reservations_status_check
    CHECK (status IN ('confirmed', 'cancelled', 'partial', 'completed'));

COMMENT ON TABLE boarding_logs IS 'Registro de eventos de abordaje (board, unboard, correction)';
