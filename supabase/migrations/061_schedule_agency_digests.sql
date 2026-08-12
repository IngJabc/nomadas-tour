-- ============================================================
-- 061_schedule_agency_digests.sql
-- F4-001 — Agency Daily Digest: ops_digest preference category +
-- emit_agency_event + schedule_agency_digests RPC
-- ============================================================

-- ── 1) agency_notification_preferences.category: add ops_digest ─
ALTER TABLE public.agency_notification_preferences
  DROP CONSTRAINT IF EXISTS agency_notification_preferences_category_check;

ALTER TABLE public.agency_notification_preferences
  ADD CONSTRAINT agency_notification_preferences_category_check
  CHECK (category IN (
    'trip_assignments',
    'trip_schedule_changes',
    'trip_status_updates',
    'trip_cancellations',
    'trip_reminders',
    'ops_digest'
  ));

-- Backfill defaults for existing agencies (idempotent).
-- email_enabled TRUE (opt-out, D5); in_app TRUE for seed parity (no in-app digest in v1).
INSERT INTO public.agency_notification_preferences (
  agency_id, category, in_app_enabled, email_enabled
)
SELECT a.id, 'ops_digest', TRUE, TRUE
FROM public.agencies a
ON CONFLICT (agency_id, category) DO NOTHING;

-- ── 2) emit_agency_event — outbox writer for agency.* facts ────
-- Distinct from emit_trip_event (aggregate trip / tenant_id NULL).
CREATE OR REPLACE FUNCTION public.emit_agency_event(
  p_event_type TEXT,
  p_agency_id UUID,
  p_payload JSONB,
  p_dedup_key TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.outbox_events (
    event_type,
    event_version,
    aggregate_type,
    aggregate_id,
    tenant_id,
    payload,
    status,
    attempts,
    available_at,
    dedup_key
  ) VALUES (
    p_event_type,
    1,
    'agency',
    p_agency_id,
    p_agency_id,
    p_payload,
    'pending',
    0,
    NOW(),
    p_dedup_key
  )
  ON CONFLICT DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.emit_agency_event(TEXT, UUID, JSONB, TEXT) IS
  'F4-001: single outbox writer for agency.* facts (tenant_id = agency_id, aggregate agency).';

REVOKE EXECUTE ON FUNCTION public.emit_agency_event(TEXT, UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.emit_agency_event(TEXT, UUID, JSONB, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.emit_agency_event(TEXT, UUID, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.emit_agency_event(TEXT, UUID, JSONB, TEXT) TO service_role;

-- ── 3) schedule_agency_digests ─────────────────────────────────
-- Emits agency.digest.due.v1 for eligible active agencies (email +
-- ops_digest email_enabled) that lack today's dedup_key.
-- Hour window (07:00 America/Caracas) is enforced by the Node scheduler.
-- digest_date is YYYY-MM-DD in America/Caracas (passed by worker).

CREATE OR REPLACE FUNCTION public.schedule_agency_digests(
  p_batch INTEGER DEFAULT 50,
  p_digest_date TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency RECORD;
  v_locked RECORD;
  v_digest_date TEXT;
  v_payload JSONB;
  v_dedup_key TEXT;
  v_emitted INTEGER := 0;
  v_scanned INTEGER := 0;
  v_limit INTEGER;
  v_before INTEGER;
  v_after INTEGER;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 THEN
    v_limit := 50;
  ELSE
    v_limit := LEAST(p_batch, 500);
  END IF;

  IF p_digest_date IS NULL OR btrim(p_digest_date) = '' THEN
    v_digest_date := to_char(
      (NOW() AT TIME ZONE 'America/Caracas'),
      'YYYY-MM-DD'
    );
  ELSE
    v_digest_date := btrim(p_digest_date);
  END IF;

  IF v_digest_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'schedule_agency_digests: invalid p_digest_date %', v_digest_date;
  END IF;

  FOR v_agency IN
    SELECT a.id
    FROM public.agencies a
    INNER JOIN public.agency_notification_preferences p
      ON p.agency_id = a.id
     AND p.category = 'ops_digest'
     AND p.email_enabled = TRUE
    WHERE a.status = 'active'
      AND a.email IS NOT NULL
      AND btrim(a.email) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.outbox_events oe
        WHERE oe.dedup_key =
          'agency.digest.due:' || a.id::text || ':' || v_digest_date
      )
    ORDER BY a.id ASC
    LIMIT v_limit
    FOR UPDATE OF a SKIP LOCKED
  LOOP
    v_scanned := v_scanned + 1;

    SELECT a.id, a.status, a.email
    INTO v_locked
    FROM public.agencies a
    WHERE a.id = v_agency.id;

    IF NOT FOUND
      OR v_locked.status <> 'active'
      OR v_locked.email IS NULL
      OR btrim(v_locked.email) = ''
    THEN
      CONTINUE;
    END IF;

    -- Re-check preference under concurrent opt-out.
    IF NOT EXISTS (
      SELECT 1
      FROM public.agency_notification_preferences p
      WHERE p.agency_id = v_locked.id
        AND p.category = 'ops_digest'
        AND p.email_enabled = TRUE
    ) THEN
      CONTINUE;
    END IF;

    v_dedup_key := 'agency.digest.due:' || v_locked.id::text || ':' || v_digest_date;

    IF EXISTS (
      SELECT 1 FROM public.outbox_events WHERE dedup_key = v_dedup_key
    ) THEN
      CONTINUE;
    END IF;

    v_payload := jsonb_build_object(
      'agency_id', v_locked.id,
      'digest_date', v_digest_date
    );

    SELECT COUNT(*) INTO v_before
    FROM public.outbox_events
    WHERE dedup_key = v_dedup_key;

    PERFORM public.emit_agency_event(
      'agency.digest.due',
      v_locked.id,
      v_payload,
      v_dedup_key
    );

    SELECT COUNT(*) INTO v_after
    FROM public.outbox_events
    WHERE dedup_key = v_dedup_key;

    IF v_after > v_before THEN
      v_emitted := v_emitted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'scanned', v_scanned,
    'emitted', v_emitted,
    'batch', v_limit,
    'digest_date', v_digest_date
  );
END;
$$;

COMMENT ON FUNCTION public.schedule_agency_digests(INTEGER, TEXT) IS
  'F4-001: emit agency.digest.due.v1 for eligible active agencies (idempotent via dedup_key). SECURITY DEFINER; EXECUTE service_role only.';

REVOKE EXECUTE ON FUNCTION public.schedule_agency_digests(INTEGER, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.schedule_agency_digests(INTEGER, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.schedule_agency_digests(INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_agency_digests(INTEGER, TEXT) TO service_role;
