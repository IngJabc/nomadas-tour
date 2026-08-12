-- ============================================================
-- 060_purge_completed_outbox_events.sql
-- WKR-009 — purge_completed_outbox_events RPC
--
-- Deletes batches of outbox_events with status = 'completed' older
-- than the retention window (default / floor 30 days), measured by
-- COALESCE(processed_at, updated_at).
--
-- SECURITY DEFINER; EXECUTE service_role only.
-- Does NOT grant DELETE on outbox_events to service_role.
-- Does NOT accept status as a parameter (completed only).
-- No index in this migration (evaluate via EXPLAIN in staging).
-- ============================================================

CREATE OR REPLACE FUNCTION public.purge_completed_outbox_events(
  p_batch INTEGER DEFAULT 1000,
  p_older_than_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_days INTEGER;
  v_cutoff TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  v_limit := LEAST(GREATEST(COALESCE(p_batch, 1000), 1), 1000);
  v_days := GREATEST(COALESCE(p_older_than_days, 30), 30);
  v_cutoff := NOW() - make_interval(days => v_days);

  WITH picked AS (
    SELECT e.id
    FROM public.outbox_events AS e
    WHERE e.status = 'completed'
      AND COALESCE(e.processed_at, e.updated_at) < v_cutoff
    ORDER BY COALESCE(e.processed_at, e.updated_at) ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ),
  deleted AS (
    DELETE FROM public.outbox_events AS o
    USING picked
    WHERE o.id = picked.id
    RETURNING o.id
  )
  SELECT jsonb_build_object(
    'deleted', (SELECT COUNT(*) FROM deleted),
    'batch', v_limit,
    'older_than_days', v_days,
    'cutoff', v_cutoff
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.purge_completed_outbox_events(INTEGER, INTEGER) IS
  'WKR-009: purge completed outbox_events older than retention days (floor 30). Batch hard-capped at 1000. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE EXECUTE ON FUNCTION public.purge_completed_outbox_events(INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_completed_outbox_events(INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_completed_outbox_events(INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_completed_outbox_events(INTEGER, INTEGER) TO service_role;
