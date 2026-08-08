-- ============================================================
-- 053_outbox_events_dedup_key.sql
-- WKR-007 Fase 0 — publication idempotency key (H3)
--
-- Does NOT modify trigger 049 / reservation.created.v1.
-- Existing rows keep dedup_key = NULL (partial unique ignores NULL).
-- Retrofit of trigger 049 → WKR-007.2.
-- ============================================================

ALTER TABLE public.outbox_events
  ADD COLUMN IF NOT EXISTS dedup_key TEXT NULL;

COMMENT ON COLUMN public.outbox_events.dedup_key IS
  'WKR-007 Fase 0. Deterministic publication key. NULL = not subject to unique index (e.g. reservation.created via trigger 049 until WKR-007.2).';

-- Guard: refuse to create unique index if non-null duplicates already exist.
DO $$
DECLARE
  v_dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT dedup_key
    FROM public.outbox_events
    WHERE dedup_key IS NOT NULL
    GROUP BY dedup_key
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'WKR-007 Fase 0: cannot create unique index on outbox_events.dedup_key — % duplicate non-null key group(s) found. Resolve manually; do not delete silently.',
      v_dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_events_dedup_key_unique
  ON public.outbox_events (dedup_key)
  WHERE dedup_key IS NOT NULL;
