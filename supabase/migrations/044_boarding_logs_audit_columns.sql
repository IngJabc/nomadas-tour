-- ============================================================
-- 044_boarding_logs_audit_columns.sql
-- AUD-020 P1 / M2 — Enrich boarding_logs with trip / owner / state.
--
-- Backfill:
--   trip_id               ← boarding_logs → reservations → trip_id
--   reservation_agency_id ← boarding_logs → reservations → agency_id
--   state_before / state_after remain NULL for historical rows
--     (do not invent unverifiable transitions)
-- ============================================================

ALTER TABLE public.boarding_logs
  ADD COLUMN IF NOT EXISTS trip_id UUID,
  ADD COLUMN IF NOT EXISTS reservation_agency_id UUID,
  ADD COLUMN IF NOT EXISTS state_before TEXT,
  ADD COLUMN IF NOT EXISTS state_after TEXT;

COMMENT ON COLUMN public.boarding_logs.trip_id IS
  'Trip of the reservation at write time (backfilled from reservations.trip_id).';
COMMENT ON COLUMN public.boarding_logs.reservation_agency_id IS
  'Commercial owner agency of the reservation (reservations.agency_id), not the operator.';
COMMENT ON COLUMN public.boarding_logs.state_before IS
  'Passenger boarding state before transition (boarded|unboarded). Historical rows stay NULL.';
COMMENT ON COLUMN public.boarding_logs.state_after IS
  'Passenger boarding state after transition (boarded|unboarded). Historical rows stay NULL.';

-- Deterministic backfill (no state_before/after invention)
UPDATE public.boarding_logs bl
SET
  trip_id = r.trip_id,
  reservation_agency_id = r.agency_id
FROM public.reservations r
WHERE bl.reservation_id = r.id
  AND (
    bl.trip_id IS NULL
    OR bl.reservation_agency_id IS NULL
  );

CREATE INDEX IF NOT EXISTS idx_bl_trip_id
  ON public.boarding_logs (trip_id);

CREATE INDEX IF NOT EXISTS idx_bl_reservation_agency_id
  ON public.boarding_logs (reservation_agency_id);

-- Add FKs only when backfilled values resolve cleanly
DO $$
DECLARE
  v_orphan_trips INTEGER;
  v_orphan_agencies INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_orphan_trips
  FROM public.boarding_logs bl
  LEFT JOIN public.trips t ON t.id = bl.trip_id
  WHERE bl.trip_id IS NOT NULL
    AND t.id IS NULL;

  SELECT COUNT(*) INTO v_orphan_agencies
  FROM public.boarding_logs bl
  LEFT JOIN public.agencies a ON a.id = bl.reservation_agency_id
  WHERE bl.reservation_agency_id IS NOT NULL
    AND a.id IS NULL;

  IF v_orphan_trips > 0 OR v_orphan_agencies > 0 THEN
    RAISE NOTICE
      'AUD-020 M2: skipping FKs — orphan trip_id=% orphan reservation_agency_id=%',
      v_orphan_trips,
      v_orphan_agencies;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'boarding_logs_trip_id_fkey'
    ) THEN
      ALTER TABLE public.boarding_logs
        ADD CONSTRAINT boarding_logs_trip_id_fkey
        FOREIGN KEY (trip_id) REFERENCES public.trips(id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'boarding_logs_reservation_agency_id_fkey'
    ) THEN
      ALTER TABLE public.boarding_logs
        ADD CONSTRAINT boarding_logs_reservation_agency_id_fkey
        FOREIGN KEY (reservation_agency_id) REFERENCES public.agencies(id);
    END IF;
  END IF;
END $$;
