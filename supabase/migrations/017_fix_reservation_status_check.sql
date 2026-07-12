-- ============================================================
-- 017_fix_reservation_status_check.sql
-- El servicio boardPassenger usa status 'boarded' que no estaba
-- incluido en la constraint. Se agrega 'boarded' a la lista.
-- Adicionalmente se arregla la constraint de seats que solo
-- permitia 'available','locked','reserved' pero no 'blocked' ni 'guide'.
-- ============================================================

ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS reservations_status_check,
  ADD CONSTRAINT reservations_status_check
    CHECK (status IN ('confirmed', 'cancelled', 'partial', 'completed', 'boarded'));

ALTER TABLE seats
  DROP CONSTRAINT IF EXISTS seats_status_check,
  ADD CONSTRAINT seats_status_check
    CHECK (status IN ('available', 'locked', 'reserved', 'blocked', 'guide'));
