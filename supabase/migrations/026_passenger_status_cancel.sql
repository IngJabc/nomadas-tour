-- Migration 026: Add status column to reservation_passengers
-- Enables individual passenger cancellation within a reservation

-- 1. Add status column with default 'active'
ALTER TABLE reservation_passengers
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'cancelled'));

-- 2. Backfill existing passengers as active (defensive)
UPDATE reservation_passengers SET status = 'active' WHERE status IS NULL;

-- 3. Index for filtering active passengers
CREATE INDEX IF NOT EXISTS idx_rp_status ON reservation_passengers(status);

-- 4. Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_rp_reservation_status ON reservation_passengers(reservation_id, status);
