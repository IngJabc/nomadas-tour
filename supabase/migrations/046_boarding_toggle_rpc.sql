-- ============================================================
-- 046_boarding_toggle_rpc.sql
-- AUD-020 P1 / M4 — Transactional boarding transition RPC.
--
-- Properties:
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public
--
-- Lock order (mandatory):
--   reservations FOR UPDATE
--     → reservation_passengers FOR UPDATE
--
-- Authorization is validated inside the function from typed params
-- provided by the backend. Does NOT trust auth.uid(), JWT claims,
-- or user_metadata.
--
-- Owner: migration role (postgres). Confirm after apply:
--   SELECT r.rolname
--   FROM pg_proc p
--   JOIN pg_roles r ON r.oid = p.proowner
--   WHERE p.proname = 'boarding_toggle'
--     AND pg_function_is_visible(p.oid);
-- ============================================================

CREATE OR REPLACE FUNCTION public.boarding_toggle(
  p_passenger_id UUID,
  p_boarded BOOLEAN,
  p_actor_user_id UUID,
  p_operator_agency_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation_id UUID;
  v_reservation public.reservations%ROWTYPE;
  v_passenger public.reservation_passengers%ROWTYPE;
  v_trip public.trips%ROWTYPE;
  v_actor_agency_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_boarded_at TIMESTAMPTZ;
  v_changed BOOLEAN := FALSE;
  v_new_status TEXT;
  v_boarded_count INTEGER;
  v_total_count INTEGER;
  v_state_before TEXT;
  v_state_after TEXT;
BEGIN
  IF p_passenger_id IS NULL
     OR p_boarded IS NULL
     OR p_actor_user_id IS NULL
     OR p_operator_agency_id IS NULL THEN
    RAISE EXCEPTION 'Parámetros de boarding incompletos';
  END IF;

  -- Resolve reservation id before locking (read path)
  SELECT rp.reservation_id
  INTO v_reservation_id
  FROM public.reservation_passengers rp
  WHERE rp.id = p_passenger_id;

  IF v_reservation_id IS NULL THEN
    RAISE EXCEPTION 'Pasajero no encontrado';
  END IF;

  -- 1) Lock reservation, then passenger (deadlock-safe order)
  SELECT r.*
  INTO v_reservation
  FROM public.reservations r
  WHERE r.id = v_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada';
  END IF;

  SELECT rp.*
  INTO v_passenger
  FROM public.reservation_passengers rp
  WHERE rp.id = p_passenger_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pasajero no encontrado';
  END IF;

  -- 2) Actor exists and belongs to operator agency
  SELECT u.agency_id
  INTO v_actor_agency_id
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Actor no encontrado';
  END IF;

  IF v_actor_agency_id IS DISTINCT FROM p_operator_agency_id THEN
    RAISE EXCEPTION 'El actor no pertenece a la agencia operadora';
  END IF;

  -- 3) Trip exists and allows boarding
  SELECT t.*
  INTO v_trip
  FROM public.trips t
  WHERE t.id = v_reservation.trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viaje no encontrado';
  END IF;

  IF v_trip.status = 'cancelled' THEN
    RAISE EXCEPTION 'Este viaje fue cancelado. No es posible realizar boarding.';
  END IF;

  IF v_trip.status = 'completed' THEN
    RAISE EXCEPTION 'Este viaje ya fue completado. No es posible realizar boarding.';
  END IF;

  IF v_trip.status = 'archived' THEN
    RAISE EXCEPTION 'Este viaje fue archivado. No es posible realizar boarding.';
  END IF;

  IF v_trip.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Este viaje no permite boarding.';
  END IF;

  IF v_trip.departure_time > v_now THEN
    RAISE EXCEPTION 'Este viaje aún no ha salido. No es posible realizar boarding.';
  END IF;

  -- 4) Operator agency assigned to trip
  IF NOT EXISTS (
    SELECT 1
    FROM public.trip_agencies ta
    WHERE ta.trip_id = v_trip.id
      AND ta.agency_id = p_operator_agency_id
  ) THEN
    RAISE EXCEPTION 'Tu agencia no está asignada a este viaje';
  END IF;

  -- 5) Reservation / passenger validity
  IF v_reservation.status = 'cancelled' THEN
    RAISE EXCEPTION 'La reserva fue cancelada';
  END IF;

  IF v_passenger.status = 'cancelled' THEN
    RAISE EXCEPTION 'No se puede abordar un pasajero cancelado';
  END IF;

  v_state_before := CASE WHEN v_passenger.boarded THEN 'boarded' ELSE 'unboarded' END;
  v_state_after := CASE WHEN p_boarded THEN 'boarded' ELSE 'unboarded' END;

  -- Aggregate counts from active passengers
  SELECT
    COUNT(*) FILTER (WHERE rp.boarded)::INTEGER,
    COUNT(*)::INTEGER
  INTO v_boarded_count, v_total_count
  FROM public.reservation_passengers rp
  WHERE rp.reservation_id = v_reservation.id
    AND rp.status = 'active';

  -- 6) Idempotent no-op
  IF v_passenger.boarded IS NOT DISTINCT FROM p_boarded THEN
    RETURN jsonb_build_object(
      'passenger_id', v_passenger.id,
      'boarded', v_passenger.boarded,
      'boarded_at', v_passenger.boarded_at,
      'changed', false,
      'reservation_status', v_reservation.status,
      'boarded_count', v_boarded_count,
      'total_count', v_total_count
    );
  END IF;

  -- 7) Apply transition
  v_changed := TRUE;
  v_boarded_at := CASE WHEN p_boarded THEN v_now ELSE NULL END;

  UPDATE public.reservation_passengers
  SET
    boarded = p_boarded,
    boarded_at = v_boarded_at
  WHERE id = v_passenger.id;

  SELECT
    COUNT(*) FILTER (WHERE rp.boarded)::INTEGER,
    COUNT(*)::INTEGER
  INTO v_boarded_count, v_total_count
  FROM public.reservation_passengers rp
  WHERE rp.reservation_id = v_reservation.id
    AND rp.status = 'active';

  -- 8) Recalculate reservation.status
  IF v_total_count > 0 AND v_boarded_count >= v_total_count THEN
    v_new_status := 'completed';
  ELSIF v_boarded_count > 0 THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'confirmed';
  END IF;

  UPDATE public.reservations
  SET status = v_new_status
  WHERE id = v_reservation.id;

  -- 9) Audit only when changed
  INSERT INTO public.boarding_logs (
    reservation_id,
    scanned_by,
    scanned_by_agency_id,
    reservation_passenger_id,
    action,
    seat_ids,
    trip_id,
    reservation_agency_id,
    state_before,
    state_after
  ) VALUES (
    v_reservation.id,
    p_actor_user_id,
    p_operator_agency_id,
    v_passenger.id,
    CASE WHEN p_boarded THEN 'board' ELSE 'unboard' END,
    jsonb_build_array(v_passenger.seat_id),
    v_trip.id,
    v_reservation.agency_id,
    v_state_before,
    v_state_after
  );

  -- 10) Structured result
  RETURN jsonb_build_object(
    'passenger_id', v_passenger.id,
    'boarded', p_boarded,
    'boarded_at', v_boarded_at,
    'changed', v_changed,
    'reservation_status', v_new_status,
    'boarded_count', v_boarded_count,
    'total_count', v_total_count
  );
END;
$$;

COMMENT ON FUNCTION public.boarding_toggle(UUID, BOOLEAN, UUID, UUID) IS
  'AUD-020 transactional boarding transition. SECURITY DEFINER; EXECUTE only for service_role.';

-- Prefer explicit postgres owner when the role exists (Supabase default)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.boarding_toggle(UUID, BOOLEAN, UUID, UUID) OWNER TO postgres;
  END IF;
END $$;

-- Security grants (same pattern as 037_revoke_rpc_public_execute.sql)
REVOKE EXECUTE ON FUNCTION public.boarding_toggle(UUID, BOOLEAN, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.boarding_toggle(UUID, BOOLEAN, UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.boarding_toggle(UUID, BOOLEAN, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.boarding_toggle(UUID, BOOLEAN, UUID, UUID) TO service_role;
