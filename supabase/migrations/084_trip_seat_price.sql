-- ============================================================
-- 084_trip_seat_price.sql
-- TRIP-PRICE-001 / MKT-005 Fase Tour — precio por asiento en trips.
--
-- Contexto:
--   076 agrego trips.seat_price INTEGER (centavos COP, NULL = no
--     publicado) y reservation_passengers.unit_price como snapshot.
--   081 exige seat_price al crear una reserva marketplace
--     (ERR_TRIP_PRICE_MISSING si es NULL), pero hasta ahora ningun
--     RPC de tour permitia escribir el campo: el admin no podia
--     configurarlo al crear ni al editar un viaje.
--
-- Cambio:
--   create_trip y update_trip aceptan y persisten p_seat_price.
--   Sin backfill: los viajes existentes conservan seat_price NULL.
--   update_trip: p_seat_price NULL = preservar el valor actual
--     (no existe operacion de borrado en esta fase).
--
-- Ambiguedad de sobrecarga (PostgreSQL):
--   Ambas firmas actuales reciben un argumento extra DEFAULT NULL.
--   Una llamada con el numero de argumentos antiguo seria ambigua
--   entre la firma vieja y la nueva, por eso se elimina y recrea
--   cada firma completa (mismo patron de la 065). Se conservan
--   SECURITY DEFINER, SET search_path = public, COMMENT y los
--   grants EXECUTE service_role only.
--
-- Compatible con los harnesses SQL existentes:
--   wkr_007_3 / wkr_008 / f5_001 llaman create_trip con 5 args
--   posicionales y update_trip con <= 7; los defaults cubren los
--   argumentos nuevos y la unica firma vigente resuelve la llamada.
--
-- Limite superior de p_seat_price (sin check explícito, a proposito):
--   El parametro es INTEGER: PostgreSQL ya no puede representar valores
--   por encima de 2147483647, y un literal fuera de rango se rechaza en
--   el borde de la llamada ("numeric value out of range") ANTES de entrar
--   al cuerpo de la funcion. Una comparacion "p_seat_price > 2147483647"
--   dentro del cuerpo seria codigo muerto imposible de cumplir. La capa
--   de aplicacion (Tour) valida ademas el maximo en zod y en los helpers
--   de conversion pesos->centavos. Solo se valida p_seat_price < 0,
--   que si es alcanzable via argumento negativo.
--
-- Atomicidad (sin BEGIN/COMMIT explicitos, a proposito):
--   El runner del Supabase CLI aplica cada archivo de migracion dentro de
--   su propia transaccion: los DROP + CREATE de ambas funciones son
--   atomicos a nivel de archivo. Anadir BEGIN/COMMIT dentro del archivo
--   lo romperia (ver supabase/cli#5047: un COMMIT intermedio hace que
--   db push marque falso positivo y no aplique el resto). El dry-run
--   documentado abajo (BEGIN; \i ... ROLLBACK;) sigue siendo el mecanismo
--   de prueba manual.
--
-- NO se toca: seats, trip_agencies, reservas, bloqueos, pagos,
-- pasajeros ni las RPCs de marketplace (081/083).
--
-- Dry-run:   BEGIN;  \i 084_trip_seat_price.sql   ROLLBACK;
-- ============================================================

-- ── 1) create_trip (+ p_seat_price) ─────────────────────────────
-- La firma 5-arg se elimina primero: con la nueva firma de 6 args
-- (DEFAULT NULL) convivir generaria "function is not unique".

DROP FUNCTION IF EXISTS public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID);

CREATE OR REPLACE FUNCTION public.create_trip(
  p_route_id UUID,
  p_departure_time TIMESTAMPTZ,
  p_vehicle_type TEXT,
  p_agency_ids UUID[],
  p_created_by UUID,
  p_seat_price INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_ids UUID[];
  v_capacity INTEGER;
  v_trip public.trips%ROWTYPE;
BEGIN
  IF p_agency_ids IS NULL OR cardinality(p_agency_ids) = 0 THEN
    RAISE EXCEPTION 'ERR_NO_AGENCIES: At least one agency is required';
  END IF;

  IF p_seat_price IS NOT NULL AND p_seat_price < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_SEAT_PRICE: seat_price must be a non-negative integer in cents';
  END IF;

  SELECT ARRAY(SELECT DISTINCT unnest(p_agency_ids) ORDER BY 1) INTO v_agency_ids;

  IF NOT EXISTS (SELECT 1 FROM routes WHERE id = p_route_id) THEN
    RAISE EXCEPTION 'ERR_ROUTE_NOT_FOUND: Route not found';
  END IF;

  v_capacity := CASE p_vehicle_type
    WHEN 'bus' THEN 31
    WHEN 'kia' THEN 10
    ELSE -1
  END;

  IF v_capacity = -1 THEN
    RAISE EXCEPTION 'ERR_INVALID_VEHICLE_TYPE: vehicle_type must be bus or kia';
  END IF;

  BEGIN
    INSERT INTO trips (route_id, departure_time, capacity, vehicle_type, status, created_by, seat_price)
    VALUES (p_route_id, p_departure_time, v_capacity, p_vehicle_type, 'active', p_created_by, p_seat_price)
    RETURNING * INTO v_trip;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_TRIP_DUPLICATE: Ya existe un viaje programado para esta ruta en la fecha y hora seleccionadas.';
  END;

  INSERT INTO seats (trip_id, seat_code, status)
  SELECT v_trip.id, 'A' || g, 'available'
  FROM generate_series(1, v_capacity) AS g;

  INSERT INTO trip_agencies (trip_id, agency_id)
  SELECT v_trip.id, unnest(v_agency_ids);

  PERFORM public.emit_trip_event(
    'trip.created',
    v_trip.id,
    jsonb_build_object(
      'trip_id', v_trip.id,
      'route_id', v_trip.route_id,
      'departure_time', v_trip.departure_time,
      'vehicle_type', v_trip.vehicle_type,
      'capacity', v_trip.capacity,
      'agency_ids', to_jsonb(v_agency_ids)
    ),
    'trip.created:' || v_trip.id::text
  );

  RETURN to_jsonb(v_trip);
END;
$$;

COMMENT ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID, INTEGER) IS
  'WKR-007 + F5-001 + TRIP-PRICE-001: atomic trip create + seats + trip_agencies + trip.created.v1; p_seat_price en centavos COP (NULL = no publicado). audit via trg_trips_audit. SECURITY DEFINER; EXECUTE service_role only.';

-- ── 2) update_trip (+ p_seat_price) ─────────────────────────────
-- Se elimina la firma 7-arg vigente (065) para evitar ambiguedad
-- con la nueva de 8 args (DEFAULT NULL).

DROP FUNCTION IF EXISTS public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN, UUID);

CREATE OR REPLACE FUNCTION public.update_trip(
  p_trip_id UUID,
  p_route_id UUID,
  p_departure_time TIMESTAMPTZ,
  p_vehicle_type TEXT,
  p_agency_ids UUID[],
  p_postpone BOOLEAN DEFAULT FALSE,
  p_actor_user_id UUID DEFAULT NULL,
  p_seat_price INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_agency_ids UUID[];
  v_current_agency_ids UUID[];
  v_removed UUID[];
  v_added UUID[];
  v_new_capacity INTEGER;
  v_old_capacity INTEGER;
  v_old_departure TIMESTAMPTZ;
  v_excess TEXT[];
  v_in_use INTEGER;
  v_pass_refs INTEGER;
  v_changed_fields TEXT[] := '{}';
  v_sorted_fields TEXT[] := '{}';
  v_fields_hash TEXT;
  v_real_postpone BOOLEAN;
  v_union_agency_ids UUID[];
  v_emitted_event TEXT := NULL;
BEGIN
  IF p_seat_price IS NOT NULL AND p_seat_price < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_SEAT_PRICE: seat_price must be a non-negative integer in cents';
  END IF;

  SELECT * INTO v_trip FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;

  IF v_trip.status <> 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_ACTIVE: Trip is not active';
  END IF;

  IF p_agency_ids IS NULL OR cardinality(p_agency_ids) = 0 THEN
    RAISE EXCEPTION 'ERR_NO_AGENCIES: At least one agency is required';
  END IF;

  SELECT ARRAY(SELECT DISTINCT unnest(p_agency_ids) ORDER BY 1) INTO v_agency_ids;

  IF NOT EXISTS (SELECT 1 FROM routes WHERE id = p_route_id) THEN
    RAISE EXCEPTION 'ERR_ROUTE_NOT_FOUND: Route not found';
  END IF;

  v_new_capacity := CASE p_vehicle_type
    WHEN 'bus' THEN 31
    WHEN 'kia' THEN 10
    ELSE -1
  END;

  IF v_new_capacity = -1 THEN
    RAISE EXCEPTION 'ERR_INVALID_VEHICLE_TYPE: vehicle_type must be bus or kia';
  END IF;

  IF v_trip.route_id IS DISTINCT FROM p_route_id THEN
    v_changed_fields := array_append(v_changed_fields, 'route_id');
  END IF;
  IF v_trip.departure_time IS DISTINCT FROM p_departure_time THEN
    v_changed_fields := array_append(v_changed_fields, 'departure_time');
  END IF;
  IF v_trip.capacity IS DISTINCT FROM v_new_capacity THEN
    v_changed_fields := array_append(v_changed_fields, 'capacity');
  END IF;
  IF v_trip.vehicle_type IS DISTINCT FROM p_vehicle_type THEN
    v_changed_fields := array_append(v_changed_fields, 'vehicle_type');
  END IF;
  IF p_seat_price IS NOT NULL AND v_trip.seat_price IS DISTINCT FROM p_seat_price THEN
    v_changed_fields := array_append(v_changed_fields, 'seat_price');
  END IF;

  SELECT COALESCE(array_agg(agency_id ORDER BY agency_id), '{}'::uuid[])
  INTO v_current_agency_ids
  FROM trip_agencies
  WHERE trip_id = p_trip_id;

  IF NOT (v_current_agency_ids = v_agency_ids) THEN
    v_changed_fields := array_append(v_changed_fields, 'agency_ids');
  END IF;

  v_old_capacity := v_trip.capacity;
  v_old_departure := v_trip.departure_time;
  v_real_postpone := p_postpone AND (v_trip.departure_time IS DISTINCT FROM p_departure_time);

  BEGIN
    UPDATE trips
    SET route_id = p_route_id,
        departure_time = p_departure_time,
        capacity = v_new_capacity,
        vehicle_type = p_vehicle_type,
        seat_price = COALESCE(p_seat_price, seat_price),
        postponed_from = CASE
          WHEN v_real_postpone THEN v_old_departure
          ELSE postponed_from
        END,
        updated_by = p_actor_user_id
    WHERE id = p_trip_id
    RETURNING * INTO v_trip;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_TRIP_DUPLICATE: Ya existe un viaje programado para esta ruta en la fecha y hora seleccionadas.';
  END;

  IF v_new_capacity > v_old_capacity THEN
    INSERT INTO seats (trip_id, seat_code, status)
    SELECT p_trip_id, 'A' || g, 'available'
    FROM generate_series(v_old_capacity + 1, v_new_capacity) AS g
    ON CONFLICT (trip_id, seat_code) DO NOTHING;
  ELSIF v_new_capacity < v_old_capacity THEN
    v_excess := ARRAY(
      SELECT 'A' || g
      FROM generate_series(v_new_capacity + 1, v_old_capacity) AS g
    );

    SELECT count(*) INTO v_in_use
    FROM seats
    WHERE trip_id = p_trip_id
      AND seat_code = ANY(v_excess)
      AND status <> 'available';

    IF v_in_use > 0 THEN
      RAISE EXCEPTION 'ERR_SEATS_IN_USE: No se puede reducir capacidad: hay asientos con actividad';
    END IF;

    SELECT count(*) INTO v_pass_refs
    FROM reservation_passengers rp
    JOIN seats s ON s.id = rp.seat_id
    WHERE s.trip_id = p_trip_id
      AND s.seat_code = ANY(v_excess);

    IF v_pass_refs > 0 THEN
      RAISE EXCEPTION 'ERR_SEATS_IN_USE: No se puede reducir capacidad: hay pasajeros en esos asientos';
    END IF;

    DELETE FROM seats
    WHERE trip_id = p_trip_id
      AND seat_code = ANY(v_excess);
  END IF;

  v_removed := ARRAY(
    SELECT unnest(v_current_agency_ids)
    EXCEPT
    SELECT unnest(v_agency_ids)
  );
  v_added := ARRAY(
    SELECT unnest(v_agency_ids)
    EXCEPT
    SELECT unnest(v_current_agency_ids)
  );

  IF cardinality(v_removed) > 0 THEN
    DELETE FROM trip_agencies
    WHERE trip_id = p_trip_id
      AND agency_id = ANY(v_removed);
  END IF;

  IF cardinality(v_added) > 0 THEN
    INSERT INTO trip_agencies (trip_id, agency_id)
    SELECT p_trip_id, unnest(v_added);
  END IF;

  IF v_real_postpone THEN
    v_union_agency_ids := ARRAY(
      SELECT DISTINCT unnest(v_current_agency_ids || v_agency_ids) ORDER BY 1
    );

    PERFORM public.emit_trip_event(
      'trip.postponed',
      p_trip_id,
      jsonb_build_object(
        'trip_id', p_trip_id,
        'route_id', p_route_id,
        'previous_departure_time', v_old_departure,
        'departure_time', p_departure_time,
        'agency_ids', to_jsonb(v_union_agency_ids)
      ),
      'trip.postponed:' || p_trip_id::text
        || ':' || to_char(v_old_departure AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        || ':' || to_char(p_departure_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    );
    v_emitted_event := 'trip.postponed';
  ELSE
    v_sorted_fields := ARRAY(
      SELECT unnest(v_changed_fields) ORDER BY 1
    );

    IF cardinality(v_sorted_fields) > 0 THEN
      v_fields_hash := md5(array_to_string(v_sorted_fields, ','));
      PERFORM public.emit_trip_event(
        'trip.updated',
        p_trip_id,
        jsonb_build_object(
          'trip_id', p_trip_id,
          'route_id', p_route_id,
          'departure_time', p_departure_time,
          'changed_fields', to_jsonb(v_sorted_fields),
          'agency_ids', to_jsonb(v_agency_ids)
        ),
        'trip.updated:' || p_trip_id::text || ':' || v_fields_hash
      );
      v_emitted_event := 'trip.updated';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'trip_id', p_trip_id,
    'action', CASE WHEN v_real_postpone THEN 'postponed' ELSE 'updated' END,
    'event_type', v_emitted_event,
    'changed_fields', to_jsonb(v_sorted_fields)
  );
END;
$$;

COMMENT ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN, UUID, INTEGER) IS
  'WKR-007 + F5-001 + TRIP-PRICE-001: trip edit + seats/agencies + outbox; p_seat_price en centavos COP, NULL = preservar el valor actual (sin borrado); sets updated_by for audit. p_actor_user_id DEFAULT NULL keeps older positional calls valid. SECURITY DEFINER; EXECUTE service_role only.';

-- ── 3) EXECUTE grants (service_role only, misma posture 037/047) ─

REVOKE EXECUTE ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_trip(UUID, TIMESTAMPTZ, TEXT, UUID[], UUID, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN, UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN, UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID[], BOOLEAN, UUID, INTEGER) TO service_role;
