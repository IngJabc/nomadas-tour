-- ============================================================
-- 059_schedule_trip_reminders.sql
-- WKR-008 — schedule_trip_reminders RPC + trip_reminder notification type
-- + trip_reminders preference category
-- ============================================================

-- ── 1) notifications.type CHECK: add trip_reminder ─────────────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'trip_created',
    'trip_cancelled',
    'trip_completed',
    'trip_auto_completed',
    'trip_postponed',
    'trip_archived',
    'trip_reminder',
    'reservation_created',
    'reservation_cancelled',
    'passenger_cancelled'
  ));

-- ── 2) agency_notification_preferences.category: add trip_reminders ─
ALTER TABLE public.agency_notification_preferences
  DROP CONSTRAINT IF EXISTS agency_notification_preferences_category_check;

ALTER TABLE public.agency_notification_preferences
  ADD CONSTRAINT agency_notification_preferences_category_check
  CHECK (category IN (
    'trip_assignments',
    'trip_schedule_changes',
    'trip_status_updates',
    'trip_cancellations',
    'trip_reminders'
  ));

-- Backfill defaults for existing agencies (idempotent).
INSERT INTO public.agency_notification_preferences (
  agency_id, category, in_app_enabled, email_enabled
)
SELECT a.id, 'trip_reminders', TRUE, TRUE
FROM public.agencies a
ON CONFLICT (agency_id, category) DO NOTHING;

-- ── 3) schedule_trip_reminders ─────────────────────────────────
-- Polls active trips inside the T-48h / T-24h windows and emits
-- trip.reminder_due.v1 via emit_trip_event (dedup_key ON CONFLICT DO NOTHING).
--
-- Window selection (catch-up safe; ONLY 't48' | 't24' — no other windows):
--   t24 when departure - 24h <= now < departure
--   t48 when departure - 48h <= now < departure - 24h
-- If the worker was down through T-48h and resumes in T-24h, only t24 is emitted.
--
-- Candidate pre-filter: window is computed inline in SQL (CASE) before the
-- dedup_key NOT EXISTS check — never via a PL/pgSQL variable that could be NULL.
-- emit_trip_event remains the final idempotency guarantee.
--
-- TOCTOU: FOR UPDATE OF t SKIP LOCKED + revalidate status/departure under the
-- row lock before emit, so cancel/postpone committed concurrently cannot yield
-- a reminder for an ineligible trip.

CREATE OR REPLACE FUNCTION public.schedule_trip_reminders(
  p_batch INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_trip RECORD;
  v_locked RECORD;
  v_window TEXT;
  v_agency_ids UUID[];
  v_payload JSONB;
  v_dedup_key TEXT;
  v_departure_key TEXT;
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

  FOR v_trip IN
    SELECT
      t.id,
      t.route_id,
      t.departure_time,
      CASE
        WHEN t.departure_time <= v_now + INTERVAL '24 hours' THEN 't24'
        ELSE 't48'
      END AS reminder_window
    FROM public.trips t
    WHERE t.status = 'active'
      AND t.departure_time > v_now
      AND t.departure_time <= v_now + INTERVAL '48 hours'
      AND NOT EXISTS (
        SELECT 1
        FROM public.outbox_events oe
        WHERE oe.dedup_key =
          'trip.reminder_due:'
          || t.id::text
          || ':'
          || CASE
               WHEN t.departure_time <= v_now + INTERVAL '24 hours' THEN 't24'
               ELSE 't48'
             END
          || ':'
          || to_char(
               t.departure_time AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
             )
      )
    ORDER BY t.departure_time ASC
    LIMIT v_limit
    FOR UPDATE OF t SKIP LOCKED
  LOOP
    v_scanned := v_scanned + 1;

    -- Revalidate under row lock (READ COMMITTED sees latest committed state).
    SELECT t.id, t.route_id, t.departure_time, t.status
    INTO v_locked
    FROM public.trips t
    WHERE t.id = v_trip.id;

    IF NOT FOUND
      OR v_locked.status <> 'active'
      OR v_locked.departure_time <= v_now
      OR v_locked.departure_time > v_now + INTERVAL '48 hours'
    THEN
      CONTINUE;
    END IF;

    IF v_locked.departure_time <= v_now + INTERVAL '24 hours' THEN
      v_window := 't24';
    ELSE
      v_window := 't48';
    END IF;

    v_departure_key := to_char(
      v_locked.departure_time AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    );

    v_dedup_key := 'trip.reminder_due:'
      || v_locked.id::text
      || ':' || v_window
      || ':' || v_departure_key;

    -- Departure may have changed while waiting for the lock; skip if already emitted.
    IF EXISTS (
      SELECT 1 FROM public.outbox_events WHERE dedup_key = v_dedup_key
    ) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(array_agg(ta.agency_id ORDER BY ta.agency_id), '{}'::uuid[])
    INTO v_agency_ids
    FROM public.trip_agencies ta
    WHERE ta.trip_id = v_locked.id;

    v_payload := jsonb_build_object(
      'trip_id', v_locked.id,
      'route_id', v_locked.route_id,
      'departure_time', v_locked.departure_time,
      'window', v_window,
      'agency_ids', to_jsonb(v_agency_ids)
    );

    SELECT COUNT(*) INTO v_before
    FROM public.outbox_events
    WHERE dedup_key = v_dedup_key;

    PERFORM public.emit_trip_event(
      'trip.reminder_due',
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
    'batch', v_limit
  );
END;
$$;

COMMENT ON FUNCTION public.schedule_trip_reminders(INTEGER) IS
  'WKR-008: poll active trips in T-48h/T-24h windows and emit trip.reminder_due.v1 (idempotent via dedup_key). SECURITY DEFINER; EXECUTE service_role only.';

REVOKE EXECUTE ON FUNCTION public.schedule_trip_reminders(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.schedule_trip_reminders(INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.schedule_trip_reminders(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_trip_reminders(INTEGER) TO service_role;
