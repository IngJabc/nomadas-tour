-- ============================================================
-- 068_seat_lock_expires_at.sql
-- F5-004 — Per-seat lock expiry (wizard TTL 600s)
--
-- Deploy with lockSeat writes + all three cleanups in the same
-- release window. Do not create production links until cleanup
-- uses lock_expires_at (not locked_at + TTL).
-- ============================================================

ALTER TABLE public.seats
  ADD COLUMN IF NOT EXISTS lock_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.seats.lock_expires_at IS
  'F5-004: absolute lock expiry. Wizard writes NOW()+600s; link RPC extends to NOW()+900s.';

UPDATE public.seats
SET lock_expires_at = locked_at + INTERVAL '600 seconds'
WHERE status = 'locked'
  AND lock_expires_at IS NULL
  AND locked_at IS NOT NULL;

-- Keep lock columns consistent when a seat returns to available
-- (covers 065 set_trip_status, superadmin cancel, unlock paths).
CREATE OR REPLACE FUNCTION public.trg_seats_clear_lock_on_available()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'available' THEN
    NEW.locked_by := NULL;
    NEW.locked_at := NULL;
    NEW.lock_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seats_clear_lock_on_available ON public.seats;
CREATE TRIGGER trg_seats_clear_lock_on_available
  BEFORE UPDATE OF status ON public.seats
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_seats_clear_lock_on_available();

REVOKE EXECUTE ON FUNCTION public.trg_seats_clear_lock_on_available() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_seats_clear_lock_on_available() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_seats_clear_lock_on_available() FROM authenticated;
