-- ============================================================
-- AUD-020 P4 — RPC behavior validation
--
-- Pegar completo en Supabase → SQL Editor → Run
-- SQL puro (sin \echo).
--
-- Este script MODIFICA datos de prueba y al final hace ROLLBACK
-- de toda la transacción (no deja cambios persistentes).
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_passenger_id UUID;
  v_actor_id UUID;
  v_agency_id UUID;
  v_foreign_agency_id UUID;
  v_reservation_id UUID;
  v_trip_id UUID;
  v_logs_before INTEGER;
  v_logs_after INTEGER;
  v_r1 JSONB;
  v_r2 JSONB;
  v_boarded_at_1 TIMESTAMPTZ;
  v_boarded_at_2 TIMESTAMPTZ;
BEGIN
  SELECT
    rp.id,
    u.id,
    ta.agency_id,
    r.id,
    t.id
  INTO
    v_passenger_id,
    v_actor_id,
    v_agency_id,
    v_reservation_id,
    v_trip_id
  FROM public.reservation_passengers rp
  JOIN public.reservations r ON r.id = rp.reservation_id
  JOIN public.trips t ON t.id = r.trip_id
  JOIN public.trip_agencies ta ON ta.trip_id = t.id
  JOIN public.users u ON u.agency_id = ta.agency_id
  WHERE rp.status = 'active'
    AND r.status <> 'cancelled'
    AND t.status = 'active'
    AND t.departure_time <= NOW()
  ORDER BY rp.boarded ASC, rp.id
  LIMIT 1;

  IF v_passenger_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: no operable boarding fixture (passenger/actor/assignment)';
  END IF;

  SELECT a.id
  INTO v_foreign_agency_id
  FROM public.agencies a
  WHERE a.id <> v_agency_id
  LIMIT 1;

  RAISE NOTICE 'Fixture passenger=% actor=% agency=% trip=%',
    v_passenger_id, v_actor_id, v_agency_id, v_trip_id;

  UPDATE public.reservation_passengers
  SET boarded = false, boarded_at = null
  WHERE id = v_passenger_id;

  SELECT COUNT(*) INTO v_logs_before
  FROM public.boarding_logs
  WHERE reservation_passenger_id = v_passenger_id;

  -- Case 1: board
  v_r1 := public.boarding_toggle(v_passenger_id, true, v_actor_id, v_agency_id);
  IF (v_r1->>'changed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL case1: expected changed=true, got %', v_r1;
  END IF;
  IF (v_r1->>'boarded')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL case1: expected boarded=true';
  END IF;
  IF v_r1->>'boarded_at' IS NULL THEN
    RAISE EXCEPTION 'FAIL case1: boarded_at missing';
  END IF;
  v_boarded_at_1 := (v_r1->>'boarded_at')::timestamptz;

  SELECT COUNT(*) INTO v_logs_after
  FROM public.boarding_logs
  WHERE reservation_passenger_id = v_passenger_id;
  IF v_logs_after <> v_logs_before + 1 THEN
    RAISE EXCEPTION 'FAIL case1: expected +1 boarding_log (% -> %)', v_logs_before, v_logs_after;
  END IF;
  RAISE NOTICE 'PASS case1 board changed=true';

  -- Case 3a: idempotent board
  v_logs_before := v_logs_after;
  v_r2 := public.boarding_toggle(v_passenger_id, true, v_actor_id, v_agency_id);
  IF (v_r2->>'changed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL case3: expected changed=false on second board';
  END IF;
  v_boarded_at_2 := (v_r2->>'boarded_at')::timestamptz;
  IF v_boarded_at_2 IS DISTINCT FROM v_boarded_at_1 THEN
    RAISE EXCEPTION 'FAIL case3: boarded_at must be preserved on no-op';
  END IF;
  SELECT COUNT(*) INTO v_logs_after
  FROM public.boarding_logs
  WHERE reservation_passenger_id = v_passenger_id;
  IF v_logs_after <> v_logs_before THEN
    RAISE EXCEPTION 'FAIL case3: no-op must not insert boarding_logs';
  END IF;
  RAISE NOTICE 'PASS case3 idempotent board changed=false';

  -- Case 2: unboard
  v_logs_before := v_logs_after;
  v_r1 := public.boarding_toggle(v_passenger_id, false, v_actor_id, v_agency_id);
  IF (v_r1->>'changed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL case2: expected changed=true on unboard';
  END IF;
  IF (v_r1->>'boarded')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL case2: expected boarded=false';
  END IF;
  IF v_r1->>'boarded_at' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL case2: boarded_at must be null';
  END IF;
  SELECT COUNT(*) INTO v_logs_after
  FROM public.boarding_logs
  WHERE reservation_passenger_id = v_passenger_id;
  IF v_logs_after <> v_logs_before + 1 THEN
    RAISE EXCEPTION 'FAIL case2: expected +1 boarding_log on unboard';
  END IF;
  RAISE NOTICE 'PASS case2 unboard changed=true';

  -- Case 3b: idempotent unboard
  v_logs_before := v_logs_after;
  v_r2 := public.boarding_toggle(v_passenger_id, false, v_actor_id, v_agency_id);
  IF (v_r2->>'changed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FAIL case3b: expected changed=false on second unboard';
  END IF;
  SELECT COUNT(*) INTO v_logs_after
  FROM public.boarding_logs
  WHERE reservation_passenger_id = v_passenger_id;
  IF v_logs_after <> v_logs_before THEN
    RAISE EXCEPTION 'FAIL case3b: no-op unboard must not insert log';
  END IF;
  RAISE NOTICE 'PASS case3b idempotent unboard';

  -- Security: foreign operator agency rejected
  IF v_foreign_agency_id IS NOT NULL THEN
    BEGIN
      PERFORM public.boarding_toggle(
        v_passenger_id, true, v_actor_id, v_foreign_agency_id
      );
      RAISE EXCEPTION 'FAIL auth: foreign operator_agency_id was allowed';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM ILIKE '%no pertenece a la agencia operadora%'
           OR SQLERRM ILIKE '%no está asignada%' THEN
          RAISE NOTICE 'PASS auth: unauthorized agency rejected (% )', SQLERRM;
        ELSE
          RAISE EXCEPTION 'FAIL auth: unexpected error %', SQLERRM;
        END IF;
    END;
  ELSE
    RAISE NOTICE 'SKIP auth foreign-agency: only one agency in DB';
  END IF;

  RAISE NOTICE 'AUD-020 P4 behavior PASS';
END $$;

SELECT
  'AUD-020 P4 RPC behavior' AS check_name,
  'PASS' AS status,
  'board / unboard / idempotency / foreign agency deny (rolled back below)' AS detail;

-- Descarta todos los cambios de esta corrida
ROLLBACK;
