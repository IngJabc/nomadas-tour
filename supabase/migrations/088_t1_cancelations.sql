-- 088_t1_cancelations.sql
-- MKT-008: T-1 cancelación por pasajero
-- 1) Función única de recálculo de payment_status
-- 2) Trigger en reservation_passengers (recalc automático — dispara en CUALQUIER cancelación)
-- 3) Trigger en checkout_attempts (outbox expiración próxima a salida) + índice único parcial
-- 4) RPC schedule_marketplace_t1_cancellations

-- ============================================================
-- 1) Función única de recálculo (v_active=0 → SIEMPRE 'cancelled')
-- ============================================================

CREATE OR REPLACE FUNCTION public.recalculate_reservation_payment_status(
  p_reservation_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_expected   INTEGER;
  v_verified   INTEGER;
  v_active     INTEGER;
  v_new_status TEXT;
BEGIN
  SELECT * INTO v_reservation
  FROM public.reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_reservation.source <> 'marketplace' THEN
    RETURN v_reservation.payment_status;
  END IF;

  SELECT count(*) INTO v_active
  FROM public.reservation_passengers
  WHERE reservation_id = p_reservation_id AND status = 'active';

  -- v_active=0 → SIEMPRE 'cancelled'. Refunds viven en reservation_refunds.
  IF v_active = 0 THEN
    UPDATE public.reservations
    SET payment_status = 'cancelled'
    WHERE id = p_reservation_id;
    RETURN 'cancelled';
  END IF;

  SELECT COALESCE(SUM(rp.unit_price), 0) INTO v_expected
  FROM public.reservation_passengers rp
  WHERE rp.reservation_id = p_reservation_id AND rp.status = 'active';

  SELECT COALESCE(SUM(pa.amount_cents), 0) INTO v_verified
  FROM public.payment_allocations pa
  JOIN public.payments p ON p.id = pa.payment_id AND p.status = 'verified'
  JOIN public.reservation_passengers rp ON rp.id = pa.reservation_passenger_id
  WHERE rp.reservation_id = p_reservation_id AND rp.status = 'active';

  v_new_status := CASE
    WHEN v_expected = 0 THEN 'pending'
    WHEN v_verified >= v_expected THEN 'fully_paid'
    WHEN v_verified > 0 THEN 'partial'
    ELSE 'pending'
  END;

  UPDATE public.reservations
  SET payment_status = v_new_status
  WHERE id = p_reservation_id;

  RETURN v_new_status;
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_reservation_payment_status(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_reservation_payment_status(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.recalculate_reservation_payment_status(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_reservation_payment_status(UUID) TO service_role;

-- NOTE: MKT-009 debe respetar invariante F-01:
-- excluir pasajeros con status='cancelled' o reservation_refunds
-- status IN ('required','completed') para su reservation_passenger_id.

-- ============================================================
-- 2) Trigger en reservation_passengers (dispara en CUALQUIER cancelación)
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_rp_cancelled_recalc_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalculate_reservation_payment_status(NEW.reservation_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER rp_cancelled_recalc_payment_t
AFTER UPDATE OF status ON public.reservation_passengers
FOR EACH ROW
WHEN (NEW.status = 'cancelled' AND OLD.status <> 'cancelled')
EXECUTE FUNCTION public.trg_rp_cancelled_recalc_payment();

-- ============================================================
-- 3) Trigger en checkout_attempts + índice único parcial
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_ca_expired_emit_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_departure TIMESTAMPTZ;
BEGIN
  SELECT departure_time INTO v_departure
  FROM public.trips WHERE id = NEW.trip_id;

  IF v_departure IS NOT NULL
     AND v_departure <= now() + INTERVAL '24 hours'
  THEN
    -- Índice único parcial maneja idempotencia (ON CONFLICT DO NOTHING)
    INSERT INTO public.outbox_events (
      event_type,
      event_version,
      aggregate_type,
      aggregate_id,
      tenant_id,
      payload,
      status,
      attempts,
      available_at
    ) VALUES (
      'checkout.expired_near_departure',
      1,
      'checkout_attempt',
      NEW.id,
      NEW.agency_id,
      jsonb_build_object(
        'checkout_attempt_id', NEW.id,
        'trip_id', NEW.trip_id,
        'customer_id', NEW.customer_id,
        'expired_at', now()
      ),
      'pending',
      0,
      now()
    )
    ON CONFLICT (aggregate_id) WHERE event_type = 'checkout.expired_near_departure' DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Índice único parcial para idempotencia (debe existir ANTES del trigger)
CREATE UNIQUE INDEX uq_outbox_checkout_expired
ON public.outbox_events (aggregate_id)
WHERE event_type = 'checkout.expired_near_departure';

CREATE TRIGGER ca_expired_emit_outbox_t
AFTER UPDATE OF status ON public.checkout_attempts
FOR EACH ROW
WHEN (NEW.status = 'expired' AND OLD.status <> 'expired')
EXECUTE FUNCTION public.trg_ca_expired_emit_outbox();

-- ============================================================
-- 4) RPC schedule_marketplace_t1_cancellations
-- ============================================================

CREATE OR REPLACE FUNCTION public.schedule_marketplace_t1_cancellations(
  p_batch INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now       TIMESTAMPTZ := NOW();
  v_limit     INTEGER;
  v_rec       RECORD;
  v_cancelled INTEGER := 0;
  v_scanned   INTEGER := 0;
  v_result    JSONB;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 THEN v_limit := 50;
  ELSE v_limit := LEAST(p_batch, 500); END IF;

  FOR v_rec IN
    SELECT rp.id AS passenger_id
    FROM public.reservation_passengers rp
    JOIN (
      SELECT rp2.id AS passenger_id
      FROM public.reservation_passengers rp2
      JOIN public.reservations r ON r.id = rp2.reservation_id
      JOIN public.trips t ON t.id = r.trip_id
      WHERE r.source = 'marketplace'
        AND r.status = 'reserved'
        AND rp2.status = 'active'
        AND t.status = 'active'
        AND t.departure_time > v_now
        AND t.departure_time <= v_now + INTERVAL '24 hours'
        AND public.reservation_passenger_balance(rp2.id) > 0
      ORDER BY t.departure_time ASC
      LIMIT v_limit
    ) c ON c.passenger_id = rp.id
  LOOP
    v_scanned := v_scanned + 1;
    v_result := public.cancel_reservation_passenger(v_rec.passenger_id, NULL);
    IF (v_result->>'already_cancelled')::boolean = false THEN
      v_cancelled := v_cancelled + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'scanned', v_scanned,
    'cancelled', v_cancelled,
    'batch', v_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_marketplace_t1_cancellations(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_marketplace_t1_cancellations(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.schedule_marketplace_t1_cancellations(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_marketplace_t1_cancellations(INTEGER) TO service_role;
