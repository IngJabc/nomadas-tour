-- ============================================================
-- 051_recover_stuck_outbox_events.sql
-- WKR-006.1 — Recover outbox rows stuck in status=processing
--
-- When a worker dies mid-handler, rows remain processing forever
-- because claim_outbox_events only picks pending. This RPC
-- returns stale processing rows to pending using SKIP LOCKED
-- so multiple workers can run recovery safely.
--
-- EXECUTE: service_role only.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recover_stuck_outbox_events(
  p_stale_ms INTEGER DEFAULT 300000,
  p_limit INTEGER DEFAULT 50
)
RETURNS SETOF public.outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale interval;
BEGIN
  -- Guard against non-positive / null inputs
  v_stale := make_interval(
    secs => GREATEST(COALESCE(p_stale_ms, 300000), 1000) / 1000.0
  );

  RETURN QUERY
  WITH picked AS (
    SELECT e.id
    FROM public.outbox_events AS e
    WHERE e.status = 'processing'
      AND e.updated_at < NOW() - v_stale
    ORDER BY e.updated_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outbox_events AS o
  SET
    status = 'pending',
    available_at = NOW(),
    attempts = o.attempts + 1,
    updated_at = NOW(),
    processed_at = NULL,
    error_message = left(
      COALESCE(o.error_message || '; ', '') || 'recovered_stuck_processing',
      2000
    )
  FROM picked
  WHERE o.id = picked.id
  RETURNING o.*;
END;
$$;

COMMENT ON FUNCTION public.recover_stuck_outbox_events(INTEGER, INTEGER) IS
  'WKR-006.1: requeue stale processing outbox rows (SKIP LOCKED). service_role only.';

REVOKE ALL ON FUNCTION public.recover_stuck_outbox_events(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_stuck_outbox_events(INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.recover_stuck_outbox_events(INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stuck_outbox_events(INTEGER, INTEGER) TO service_role;
