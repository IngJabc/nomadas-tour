-- ============================================================
-- 052_trips_created_at_updated_at.sql
-- WKR-007 Fase 0 — trips.created_at + auto-update updated_at
--
-- Behavior-preserving schema prep (no RPCs / no trip.* events).
-- ============================================================

-- Backfill strategy for created_at:
-- outbox_events currently only emits reservation.created (aggregate_type =
-- 'reservation'). There is no reliable trip_id ↔ outbox_events correspondence
-- for historical trips, so existing rows are backfilled with NOW().
-- New inserts use DEFAULT NOW().

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE public.trips
SET created_at = NOW()
WHERE created_at IS NULL;

ALTER TABLE public.trips
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE public.trips
  ALTER COLUMN created_at SET NOT NULL;

COMMENT ON COLUMN public.trips.created_at IS
  'WKR-007 Fase 0. Historical rows backfilled with NOW() because no trip.* outbox events exist yet for a reliable join.';

-- updated_at: present on DBs that retained 006; may be missing after 010/011 reset.
-- Ensure column exists before attaching the BEFORE UPDATE trigger.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.trips
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;

-- Recreate trigger (idempotent). Function update_updated_at() exists since 011.
DROP TRIGGER IF EXISTS trips_updated_at ON public.trips;

CREATE TRIGGER trips_updated_at
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
