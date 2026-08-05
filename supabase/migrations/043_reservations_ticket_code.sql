-- ============================================================
-- 043_reservations_ticket_code.sql
-- AUD-020 P1 / M1 — Persist short boarding credential on reservations.
--
-- Rules:
--   - CHAR(8), format [A-F0-9]{8}
--   - Derive from reservations.id (UUID), NEVER from qr_code
--   - Precheck collisions; abort (do not silently remap) if duplicates exist
--   - Keep NULLABLE until future generation path is confirmed
--   - Do NOT modify create_agency_reservation in this migration
-- ============================================================

-- 1) Add nullable column
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS ticket_code CHAR(8);

COMMENT ON COLUMN public.reservations.ticket_code IS
  'Short boarding credential (8 hex chars). Derived from reservation UUID; exact-match lookup only. Nullable until creation RPC generates it.';

-- 2) Backfill from reservation UUID (not qr_code)
UPDATE public.reservations
SET ticket_code = UPPER(LEFT(REPLACE(id::text, '-', ''), 8))
WHERE ticket_code IS NULL;

-- 3) Collision precheck — fail loudly; do not resolve silently
DO $$
DECLARE
  v_collision_groups INTEGER;
  v_sample TEXT;
BEGIN
  SELECT COUNT(*) INTO v_collision_groups
  FROM (
    SELECT ticket_code
    FROM public.reservations
    WHERE ticket_code IS NOT NULL
    GROUP BY ticket_code
    HAVING COUNT(*) > 1
  ) collisions;

  IF v_collision_groups > 0 THEN
    SELECT string_agg(
      format('%s (%s rows)', ticket_code, total),
      ', '
      ORDER BY ticket_code
    )
    INTO v_sample
    FROM (
      SELECT ticket_code, COUNT(*) AS total
      FROM public.reservations
      WHERE ticket_code IS NOT NULL
      GROUP BY ticket_code
      HAVING COUNT(*) > 1
      LIMIT 10
    ) sample;

    RAISE EXCEPTION
      'AUD-020 M1: ticket_code backfill collisions detected (% group(s)). Sample: %. Resolve manually before UNIQUE. Do not remap silently.',
      v_collision_groups,
      COALESCE(v_sample, '(none)');
  END IF;
END $$;

-- 4) Format CHECK (NULLs allowed)
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_ticket_code_format_check;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_ticket_code_format_check
  CHECK (ticket_code IS NULL OR ticket_code::text ~ '^[A-F0-9]{8}$');

-- 5) UNIQUE (multiple NULLs remain allowed in PostgreSQL)
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_ticket_code_key;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_ticket_code_key UNIQUE (ticket_code);
