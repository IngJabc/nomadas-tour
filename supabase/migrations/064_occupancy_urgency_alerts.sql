-- ============================================================
-- 064_occupancy_urgency_alerts.sql
-- F4-004 — Occupancy Urgency Alerts (in-app): extend evaluate_occupancy_alerts
-- with T-24h urgency escalation over F4-003 persisted state.
--
-- No new table. No new state machine. No email. No pg_cron.
-- p_urgency_enabled DEFAULT FALSE keeps F4-003 soak-safe.
-- ============================================================

-- Replace 3-arg overload with 4-arg (DEFAULT keeps 3-arg call sites valid).
DROP FUNCTION IF EXISTS public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID);

CREATE OR REPLACE FUNCTION public.evaluate_occupancy_alerts(
  p_batch INTEGER DEFAULT 50,
  p_after_departure TIMESTAMPTZ DEFAULT NULL,
  p_after_id UUID DEFAULT NULL,
  p_urgency_enabled BOOLEAN DEFAULT FALSE
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
  v_urgency_matches INTEGER := 0;
  v_urgency_emitted INTEGER := 0;
  v_already_escalated INTEGER := 0;
  v_last_departure TIMESTAMPTZ := NULL;
  v_last_id UUID := NULL;
  v_has_keyset BOOLEAN;
  v_has_more BOOLEAN := FALSE;
  v_urgency_on BOOLEAN := COALESCE(p_urgency_enabled, FALSE);
BEGIN
  IF p_batch IS NULL OR p_batch < 1 THEN
    v_limit := 50;
  ELSE
    v_limit := LEAST(p_batch, 500);
  END IF;

  v_has_keyset := (p_after_departure IS NOT NULL AND p_after_id IS NOT NULL);

  -- Cleanup: ineligible trips. No event. (F4-003 unchanged)
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
      -- NORMAL → enter (F4-003). No urgency this tick (sequencing §6).
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
        -- F4-004: stay alerted + T-24h urgency (pre-existing state only)
        IF (v_locked.departure_time - v_now) <= INTERVAL '24 hours' THEN
          v_urgency_matches := v_urgency_matches + 1;
          IF v_urgency_on THEN
            v_dedup_key := 'trip.occupancy_urgency:'
              || v_locked.id::TEXT
              || ':near_full:t24:'
              || to_char(
                v_locked.departure_time AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              );
            v_payload := jsonb_build_object(
              'trip_id', v_locked.id,
              'alert_type', 'near_full',
              'occupancy_pct', v_occupancy,
              'departure_time', v_locked.departure_time,
              'route_id', v_locked.route_id,
              'urgency_window', 't24'
            );
            SELECT COUNT(*) INTO v_before
            FROM public.outbox_events
            WHERE dedup_key = v_dedup_key;
            PERFORM public.emit_trip_event(
              'trip.occupancy_urgency.due',
              v_locked.id,
              v_payload,
              v_dedup_key
            );
            SELECT COUNT(*) INTO v_after
            FROM public.outbox_events
            WHERE dedup_key = v_dedup_key;
            IF v_after > v_before THEN
              v_urgency_emitted := v_urgency_emitted + 1;
            ELSE
              v_already_escalated := v_already_escalated + 1;
            END IF;
          END IF;
        END IF;
      END IF;
    ELSIF v_existing_type = 'underbooked' THEN
      IF v_occupancy > 25 THEN
        DELETE FROM public.trip_occupancy_alert_state
        WHERE trip_id = v_locked.id;
      ELSE
        v_skipped := v_skipped + 1;
        -- F4-004: stay alerted + T-24h urgency (pre-existing state only)
        IF (v_locked.departure_time - v_now) <= INTERVAL '24 hours' THEN
          v_urgency_matches := v_urgency_matches + 1;
          IF v_urgency_on THEN
            v_dedup_key := 'trip.occupancy_urgency:'
              || v_locked.id::TEXT
              || ':underbooked:t24:'
              || to_char(
                v_locked.departure_time AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              );
            v_payload := jsonb_build_object(
              'trip_id', v_locked.id,
              'alert_type', 'underbooked',
              'occupancy_pct', v_occupancy,
              'departure_time', v_locked.departure_time,
              'route_id', v_locked.route_id,
              'urgency_window', 't24'
            );
            SELECT COUNT(*) INTO v_before
            FROM public.outbox_events
            WHERE dedup_key = v_dedup_key;
            PERFORM public.emit_trip_event(
              'trip.occupancy_urgency.due',
              v_locked.id,
              v_payload,
              v_dedup_key
            );
            SELECT COUNT(*) INTO v_after
            FROM public.outbox_events
            WHERE dedup_key = v_dedup_key;
            IF v_after > v_before THEN
              v_urgency_emitted := v_urgency_emitted + 1;
            ELSE
              v_already_escalated := v_already_escalated + 1;
            END IF;
          END IF;
        END IF;
      END IF;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  -- Exact has_more (F4-003 unchanged)
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
    END,
    'urgency_matches', v_urgency_matches,
    'urgency_emitted', v_urgency_emitted,
    'already_escalated', v_already_escalated
  );
END;
$$;

COMMENT ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID, BOOLEAN) IS
  'F4-003/F4-004: occupancy alert transitions + optional T-24h urgency. Keyset (departure_time, id). SECURITY DEFINER; EXECUTE service_role only.';

REVOKE EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID, BOOLEAN) FROM anon;
REVOKE EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID, BOOLEAN) TO service_role;
