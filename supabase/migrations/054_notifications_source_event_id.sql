-- ============================================================
-- 054_notifications_source_event_id.sql
-- WKR-007 Fase 0 — notification fanout idempotency
--
-- Conceptual reference to outbox_events.id (no physical FK):
-- outbox retention (WKR-009) may purge completed events while
-- notifications remain as a read model.
-- ============================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS source_event_id UUID NULL;

COMMENT ON COLUMN public.notifications.source_event_id IS
  'WKR-007 Fase 0. Outbox event id that produced this notification. NULL = legacy / pre-fanout rows (not indexed).';

-- Guard: detect collisions that would break the unique index.
-- Semántica: source_event_id + agency_normalized + role_normalized
-- when source_event_id IS NOT NULL.
DO $$
DECLARE
  v_dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT
      source_event_id,
      COALESCE(agency_id::text, '*') AS agency_key,
      COALESCE(recipient_role, '*') AS role_key
    FROM public.notifications
    WHERE source_event_id IS NOT NULL
    GROUP BY
      source_event_id,
      COALESCE(agency_id::text, '*'),
      COALESCE(recipient_role, '*')
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'WKR-007 Fase 0: cannot create unique index on notifications (source_event_id, agency, role) — % duplicate group(s) found. Resolve manually; do not delete silently.',
      v_dup_count;
  END IF;
END $$;

-- Normalize NULL agency_id and NULL recipient_role to '*' so PostgreSQL
-- treats them as one stable key (unique indexes allow multiple NULLs otherwise).
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_source_event_idempotent
  ON public.notifications (
    source_event_id,
    (COALESCE(agency_id::text, '*')),
    (COALESCE(recipient_role, '*'))
  )
  WHERE source_event_id IS NOT NULL;
