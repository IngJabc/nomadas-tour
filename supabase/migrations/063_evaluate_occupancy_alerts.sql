-- ============================================================
-- 063_evaluate_occupancy_alerts.sql
-- F4-003 — Occupancy Alerts (in-app): state table + agency prefs
-- + notifications.type + evaluate_occupancy_alerts RPC
--
-- In-app only: no email path / delivery ledger.
-- Agency prefs only: no superadmin prefs table changes.
-- Runs on the existing Node worker: no cron extension, no second process.
-- ============================================================

-- ── 1) trip_occupancy_alert_state (Estrategia B) ──────────────
-- NORMAL = ausencia de fila. Fila solo mientras el viaje está alertado.
CREATE TABLE IF NOT EXISTS public.trip_occupancy_alert_state (
  trip_id UUID PRIMARY KEY REFERENCES public.trips(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('near_full', 'underbooked')),
  state TEXT NOT NULL CHECK (state IN ('near_full_alerted', 'underbooked_alerted')),
  occupancy_pct INTEGER NOT NULL CHECK (occupancy_pct >= 0 AND occupancy_pct <= 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.trip_occupancy_alert_state IS
  'F4-003: persisted occupancy alert state (Estrategia B). NORMAL = no row. PK trip_id.';

ALTER TABLE public.trip_occupancy_alert_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.trip_occupancy_alert_state FROM PUBLIC;
REVOKE ALL ON TABLE public.trip_occupancy_alert_state FROM anon;
REVOKE ALL ON TABLE public.trip_occupancy_alert_state FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trip_occupancy_alert_state TO service_role;

-- ── 2) agency_notification_preferences: occupancy_alerts ──────
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
    'ops_digest',
    'occupancy_alerts'
  ));

-- in_app ON (opt-out). email OFF — F4-003 v1 is in-app only.
INSERT INTO public.agency_notification_preferences (
  agency_id, category, in_app_enabled, email_enabled
)
SELECT a.id, 'occupancy_alerts', TRUE, FALSE
FROM public.agencies a
ON CONFLICT (agency_id, category) DO NOTHING;

-- ── 3) notifications.type: add occupancy_alert (non-destructive) ─
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
    'passenger_cancelled',
    'occupancy_alert'
  ));

-- ── 4) evaluate_occupancy_alerts ──────────────────────────────
-- Keyset (departure_time, id). Max one transition per trip per call.
-- Cleanup of ineligible state rows (no event). Invalid occupancy skipped.

CREATE OR REPLACE FUNCTION public.evaluate_occupancy_alerts(
  p_batch INTEGER DEFAULT 50,
  p_after_departure TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_limit INTEGER;
  v_trip RECORD;
  v_locked RECORD;
  v_seat_rows INTEGER;
  v_reserved INTEGER;
  v_total INTEGER;
  v_occupancy INTEGER;
  v_existing_type TEXT;
  v_updated_at TIMESTAMPTZ;
  v_alert_type TEXT;
  v_state TEXT;
  v_dedup_key TEXT;
  v_payload JSONB;
  v_before INTEGER;
  v_after INTEGER;
  v_scanned INTEGER := 0;
  v_evaluated INTEGER := 0;
  v_emitted INTEGER := 0;
  v_skipped INTEGER := 0;
  v_skipped_invalid INTEGER := 0;
  v_cleaned INTEGER := 0;
  v_last_departure TIMESTAMPTZ := NULL;
  v_last_id UUID := NULL;
  v_has_keyset BOOLEAN;
  v_has_more BOOLEAN := FALSE;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 THEN
    v_limit := 50;
  ELSE
    v_limit := LEAST(p_batch, 500);
  END IF;

  v_has_keyset := (p_after_departure IS NOT NULL AND p_after_id IS NOT NULL);

  -- Cleanup: ineligible trips. No event.
  DELETE FROM public.trip_occupancy_alert_state s
  USING public.trips t
  WHERE s.trip_id = t.id
    AND (t.status <> 'active' OR t.departure_time <= v_now);
  GET DIAGNOSTICS v_cleaned = ROW_COUNT;

  FOR v_trip IN
    SELECT t.id, t.route_id, t.departure_time, t.status, t.capacity
    FROM public.trips t
    WHERE t.status = 'active'
      AND t.departure_time > v_now
      AND (
        NOT v_has_keyset
        OR (t.departure_time, t.id) > (p_after_departure, p_after_id)
      )
    ORDER BY t.departure_time ASC, t.id ASC
    LIMIT v_limit
    FOR UPDATE OF t SKIP LOCKED
  LOOP
    v_scanned := v_scanned + 1;
    v_last_departure := v_trip.departure_time;
    v_last_id := v_trip.id;
    v_updated_at := NULL;
    v_existing_type := NULL;

    SELECT t.id, t.route_id, t.departure_time, t.status, t.capacity
    INTO v_locked
    FROM public.trips t
    WHERE t.id = v_trip.id;

    IF NOT FOUND
      OR v_locked.status <> 'active'
      OR v_locked.departure_time <= v_now
    THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT
      COUNT(*)::INTEGER,
      COUNT(*) FILTER (WHERE s.status <> 'available')::INTEGER
    INTO v_seat_rows, v_reserved
    FROM public.seats s
    WHERE s.trip_id = v_locked.id;

    IF v_seat_rows = 0 THEN
      v_total := COALESCE(v_locked.capacity, 0);
    ELSE
      v_total := v_seat_rows;
    END IF;

    IF v_total <= 0 OR v_reserved > v_total THEN
      v_skipped_invalid := v_skipped_invalid + 1;
      CONTINUE;
    END IF;

    v_occupancy := ROUND((v_reserved::NUMERIC / v_total) * 100)::INTEGER;
    v_evaluated := v_evaluated + 1;

    SELECT s.alert_type
    INTO v_existing_type
    FROM public.trip_occupancy_alert_state s
    WHERE s.trip_id = v_locked.id
    FOR UPDATE;

    IF v_existing_type IS NULL THEN
      -- NORMAL
      IF v_occupancy >= 90 THEN
        v_alert_type := 'near_full';
        v_state := 'near_full_alerted';
      ELSIF v_occupancy <= 20 THEN
        v_alert_type := 'underbooked';
        v_state := 'underbooked_alerted';
      ELSE
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      INSERT INTO public.trip_occupancy_alert_state (
        trip_id, alert_type, state, occupancy_pct
      ) VALUES (
        v_locked.id, v_alert_type, v_state, v_occupancy
      )
      ON CONFLICT (trip_id) DO NOTHING
      RETURNING updated_at INTO v_updated_at;

      IF v_updated_at IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_dedup_key := 'trip.occupancy_alert:'
        || v_locked.id::TEXT
        || ':' || v_alert_type
        || ':' || to_char(
          v_updated_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        );

      v_payload := jsonb_build_object(
        'trip_id', v_locked.id,
        'alert_type', v_alert_type,
        'occupancy_pct', v_occupancy,
        'departure_time', v_locked.departure_time,
        'route_id', v_locked.route_id
      );

      SELECT COUNT(*) INTO v_before
      FROM public.outbox_events
      WHERE dedup_key = v_dedup_key;

      PERFORM public.emit_trip_event(
        'trip.occupancy_alert.due',
        v_locked.id,
        v_payload,
        v_dedup_key
      );

      SELECT COUNT(*) INTO v_after
      FROM public.outbox_events
      WHERE dedup_key = v_dedup_key;

      IF v_after > v_before THEN
        v_emitted := v_emitted + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    ELSIF v_existing_type = 'near_full' THEN
      IF v_occupancy < 85 THEN
        DELETE FROM public.trip_occupancy_alert_state
        WHERE trip_id = v_locked.id;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    ELSIF v_existing_type = 'underbooked' THEN
      IF v_occupancy > 25 THEN
        DELETE FROM public.trip_occupancy_alert_state
        WHERE trip_id = v_locked.id;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- Exact has_more: only TRUE when a next eligible trip exists after the last
  -- scanned key. Avoids an extra empty invocation at exact batch multiples
  -- (design §8: <=50 → 1 call, 100 → 2, 300 → 6).
  IF v_scanned >= v_limit AND v_last_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.status = 'active'
        AND t.departure_time > v_now
        AND (t.departure_time, t.id) > (v_last_departure, v_last_id)
    ) INTO v_has_more;
  END IF;

  RETURN jsonb_build_object(
    'scanned', v_scanned,
    'evaluated', v_evaluated,
    'emitted', v_emitted,
    'skipped', v_skipped,
    'skipped_invalid_occupancy', v_skipped_invalid,
    'cleaned_up', v_cleaned,
    'batch', v_limit,
    'has_more', v_has_more,
    'next_cursor', CASE
      WHEN v_last_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'departure_time', v_last_departure,
        'id', v_last_id
      )
    END
  );
END;
$$;

COMMENT ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID) IS
  'F4-003: evaluate active future trips for occupancy alert transitions. Keyset (departure_time, id). SECURITY DEFINER; EXECUTE service_role only.';

REVOKE EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID) TO service_role;
