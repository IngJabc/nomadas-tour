-- ============================================================
-- 050_claim_outbox_events.sql
-- WKR-005 — Atomic outbox claim for Email Worker / relay
--
-- FOR UPDATE SKIP LOCKED so multiple worker instances do not
-- process the same pending row.
-- EXECUTE: service_role only.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_outbox_events(
  p_limit INTEGER DEFAULT 10,
  p_event_type TEXT DEFAULT NULL
)
RETURNS SETOF public.outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT e.id
    FROM public.outbox_events AS e
    WHERE e.status = 'pending'
      AND e.available_at <= NOW()
      AND (p_event_type IS NULL OR e.event_type = p_event_type)
    ORDER BY e.available_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 10), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outbox_events AS o
  SET
    status = 'processing',
    attempts = o.attempts + 1,
    updated_at = NOW(),
    error_message = NULL
  FROM picked
  WHERE o.id = picked.id
  RETURNING o.*;
END;
$$;

COMMENT ON FUNCTION public.claim_outbox_events(INTEGER, TEXT) IS
  'WKR-005: claim pending outbox rows (SKIP LOCKED). service_role only.';

REVOKE ALL ON FUNCTION public.claim_outbox_events(INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_outbox_events(INTEGER, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.claim_outbox_events(INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_events(INTEGER, TEXT) TO service_role;
