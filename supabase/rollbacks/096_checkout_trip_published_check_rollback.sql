-- ============================================================
-- 096_checkout_trip_published_check_rollback.sql
-- Rollback de la migracion 096 (TRIP-PUB-001.2 - validacion
-- transaccional de publicacion en checkout).
-- Ejecutar SOLO si la migracion 096 causa problemas en staging/prod.
--
-- Restaura el estado previo:
--   - Reemplaza public.create_checkout_attempt por su definicion
--     EXACTA de la migracion 087 (cuerpo identico, extraido
--     verbatim de 087_checkout_attempts.sql lineas 387-664):
--       * lectura del viaje SIN FOR UPDATE y SIN t.is_published
--         (vuelve la carrera documentada en TRIP-PUB-001.2)
--       * sin validacion ERR_TRIP_NOT_PUBLISHED
--       * comentario original (MKT-007)
--       * mismos REVOKE/GRANT (EXECUTE solo service_role)
--
-- IMPORTANTE - efecto sobre la garantia de integridad:
--   Tras este rollback, un checkout nuevo VUELVE A PODER crearse
--   si el viaje se despublica de forma concurrente al momento de
--   la escritura (el pre-chequeo del backend no es atomico). Los
--   checkouts, reservas, pagos, passengers, allocations, tickets QR
--   y boarding existentes NO se ven afectados: solo cambia la
--   funcion de CREACION de intentos nuevos. trips.is_published
--   (095) y trips.status NO se tocan; 095 sigue aplicada.
--
-- Orden de rollback: 096 -> (si procede) 095. Nunca aplicar este
-- rollback en un entorno donde la 096 nunca corrio (aunque
-- CREATE OR REPLACE lo haria idempotente y reejecutable).
--
-- Dry-run:  BEGIN; \i 096_checkout_trip_published_check_rollback.sql   ROLLBACK;
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_checkout_attempt(
  p_trip_id UUID,
  p_customer_id UUID,
  p_agency_id UUID,
  p_seat_ids UUID[],
  p_passenger_data JSONB,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_pax_count INTEGER;
  v_trip_status TEXT;
  v_departure TIMESTAMPTZ;
  v_unit_price INTEGER;
  v_seat RECORD;
  v_found_count INTEGER := 0;
  v_seen_docs TEXT[] := ARRAY[]::TEXT[];
  v_elem JSONB;
  v_seat_id UUID;
  v_first_name TEXT;
  v_last_name TEXT;
  v_document TEXT;
  v_i INTEGER;
  v_expires_at TIMESTAMPTZ;
  v_attempt_id UUID;
  v_key_ns TEXT;
  v_claimed_attempt UUID;
  v_existing public.checkout_attempts%ROWTYPE;
  v_rowcount BIGINT;
  v_amount INTEGER;
BEGIN
  -- 1) Identidad: siempre del servidor, nunca del cliente.
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CUSTOMER_REQUIRED: An authenticated customer is required';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_INPUT: p_idempotency_key is required';
  END IF;

  -- 2) Arreglos: exactamente un pasajero por asiento, en el MISMO
  --    orden, sin documentos repetidos. El orden de p_passenger_data
  --    es el que se congela en el snapshot y el que reproduce
  --    verify_checkout_attempt.
  v_count := array_length(p_seat_ids, 1);
  IF v_count IS NULL OR v_count = 0 THEN
    RAISE EXCEPTION 'ERR_NO_SEATS: At least one seat is required';
  END IF;

  IF (SELECT count(*) FROM (SELECT DISTINCT unnest(p_seat_ids) AS id) d) <> v_count THEN
    RAISE EXCEPTION 'ERR_SEAT_DUPLICATE: Duplicated seat in payload';
  END IF;

  IF p_passenger_data IS NULL OR jsonb_typeof(p_passenger_data) <> 'array' THEN
    RAISE EXCEPTION 'ERR_PASSENGER_MISMATCH: Passenger data must be an array';
  END IF;

  v_pax_count := jsonb_array_length(p_passenger_data);

  IF v_pax_count <> v_count THEN
    RAISE EXCEPTION 'ERR_PASSENGER_MISMATCH: Passenger data must match seat count';
  END IF;

  FOR v_i IN 0 .. v_count - 1 LOOP
    v_elem := p_passenger_data->v_i;
    v_seat_id := (v_elem->>'seat_id')::uuid;
    v_first_name := btrim(COALESCE(v_elem->>'first_name', ''));
    v_last_name := btrim(COALESCE(v_elem->>'last_name', ''));
    v_document := btrim(COALESCE(v_elem->>'document', ''));

    IF v_seat_id IS NULL OR v_seat_id IS DISTINCT FROM p_seat_ids[v_i + 1] THEN
      RAISE EXCEPTION 'ERR_PASSENGER_MISMATCH: Passenger % does not match seat %', v_i + 1, v_i + 1;
    END IF;
    IF length(v_first_name) < 2 THEN
      RAISE EXCEPTION 'ERR_PASSENGER_DATA: Passenger first name is required';
    END IF;
    IF length(v_last_name) < 2 THEN
      RAISE EXCEPTION 'ERR_PASSENGER_DATA: Passenger last name is required';
    END IF;
    IF length(v_document) = 0 THEN
      RAISE EXCEPTION 'ERR_PASSENGER_DATA: Passenger document is required';
    END IF;
    IF v_document = ANY(v_seen_docs) THEN
      RAISE EXCEPTION 'ERR_PASSENGER_DUPLICATE_DOCUMENT: Document % is repeated in this checkout', v_document;
    END IF;
    v_seen_docs := v_seen_docs || v_document;
  END LOOP;

  -- 3) Trip: existe, activo, no partio, con precio.
  SELECT t.status, t.departure_time, t.seat_price
    INTO v_trip_status, v_departure, v_unit_price
  FROM public.trips t
  WHERE t.id = p_trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;
  IF v_trip_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_ACTIVE: Trip is not active';
  END IF;
  IF v_departure <= NOW() THEN
    RAISE EXCEPTION 'ERR_TRIP_DEPARTED: Cannot start a checkout after departure time';
  END IF;
  IF v_unit_price IS NULL THEN
    RAISE EXCEPTION 'ERR_TRIP_PRICE_MISSING: Trip has no seat_price to snapshot';
  END IF;

  -- 4) Agencia: relacion real trip -> agency.
  IF NOT EXISTS (
    SELECT 1 FROM public.trip_agencies ta
    WHERE ta.trip_id = p_trip_id AND ta.agency_id = p_agency_id
  ) THEN
    RAISE EXCEPTION 'ERR_AGENCY_NOT_ASSIGNED: The trip is not offered by this agency';
  END IF;

  -- 5) Seats con FOR UPDATE: serializa checkouts concurrentes y es
  --    aqui donde se demuestra la propiedad del lock. Cada asiento
  --    debe estar bloqueado por ESTE customer (transicion guest ->
  --    customer ya hecha via claim), sin dueno guest residual y con
  --    TTL vigente. Si alguien ya lo reclamo con OTRO intento, se
  --    rechaza: dos intentos jamas comparten asientos.
  FOR v_seat IN
    SELECT s.id, s.seat_code, s.status, s.locked_by, s.guest_session_id,
           s.lock_expires_at, s.checkout_attempt_id
    FROM public.seats s
    WHERE s.trip_id = p_trip_id AND s.id = ANY(p_seat_ids)
    ORDER BY s.id
    FOR UPDATE
  LOOP
    v_found_count := v_found_count + 1;

    IF v_seat.status IS DISTINCT FROM 'locked'
       OR v_seat.locked_by IS DISTINCT FROM p_customer_id
       OR v_seat.guest_session_id IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_SEAT_NOT_OWNED: Seat % is not locked by this customer', v_seat.seat_code;
    END IF;

    IF v_seat.lock_expires_at IS NULL OR v_seat.lock_expires_at <= NOW() THEN
      RAISE EXCEPTION 'ERR_SEAT_LOCK_EXPIRED: Seat % lock expired', v_seat.seat_code;
    END IF;

    IF v_seat.checkout_attempt_id IS NOT NULL THEN
      v_claimed_attempt := v_seat.checkout_attempt_id;
    END IF;

    -- La ventana inicial del intento NUNCA supera el TTL restante:
    -- el cliente no puede prolongar su propia expiracion.
    IF v_expires_at IS NULL OR v_seat.lock_expires_at < v_expires_at THEN
      v_expires_at := v_seat.lock_expires_at;
    END IF;
  END LOOP;

  IF v_found_count <> v_count THEN
    RAISE EXCEPTION 'ERR_SEAT_NOT_FOUND: One or more seats not found in this trip';
  END IF;

  -- 5b) Idempotencia por asientos: si estos asientos ya pertenecen a
  --     un intento ABIERTO del mismo cliente con el mismo set, se
  --     devuelve ese intento (refresco/reintento no crea duplicados).
  IF v_claimed_attempt IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.checkout_attempts ca
    WHERE ca.id = v_claimed_attempt;

    IF FOUND
       AND v_existing.customer_id = p_customer_id
       AND v_existing.trip_id = p_trip_id
       AND v_existing.status NOT IN ('verified', 'expired', 'cancelled', 'rejected_final')
       AND (SELECT array_agg(u ORDER BY u) FROM unnest(v_existing.seat_ids) u)
           = (SELECT array_agg(u ORDER BY u) FROM unnest(p_seat_ids) u) THEN
      RETURN jsonb_build_object(
        'attempt_id', v_existing.id,
        'trip_id', v_existing.trip_id,
        'agency_id', v_existing.agency_id,
        'customer_id', v_existing.customer_id,
        'status', v_existing.status,
        'seat_ids', to_jsonb(v_existing.seat_ids),
        'passenger_count', cardinality(v_existing.seat_ids),
        'unit_price', v_existing.unit_price,
        'amount_cents', v_existing.amount_cents,
        'proof_count', v_existing.proof_count,
        'expires_at', v_existing.expires_at,
        'idempotent', true
      );
    END IF;

    RAISE EXCEPTION 'ERR_CHECKOUT_SEAT_CLAIMED: Seats are already claimed by another checkout attempt';
  END IF;

  -- 5c) Idempotencia por clave: misma clave + mismo cliente + mismo
  --     viaje => el intento existente. Misma clave con otro contexto
  --     => conflicto estable.
  v_key_ns := 'mkt007:' || p_customer_id::text || ':' || p_idempotency_key::text;

  SELECT * INTO v_existing
  FROM public.checkout_attempts ca
  WHERE ca.idempotency_key = v_key_ns;

  IF FOUND THEN
    IF v_existing.customer_id IS DISTINCT FROM p_customer_id
       OR v_existing.trip_id IS DISTINCT FROM p_trip_id THEN
      RAISE EXCEPTION 'ERR_CHECKOUT_IDEMPOTENCY_CONFLICT: Idempotency key reused with a different checkout';
    END IF;

    RETURN jsonb_build_object(
      'attempt_id', v_existing.id,
      'trip_id', v_existing.trip_id,
      'agency_id', v_existing.agency_id,
      'customer_id', v_existing.customer_id,
      'status', v_existing.status,
      'seat_ids', to_jsonb(v_existing.seat_ids),
      'passenger_count', cardinality(v_existing.seat_ids),
      'unit_price', v_existing.unit_price,
      'amount_cents', v_existing.amount_cents,
      'proof_count', v_existing.proof_count,
      'expires_at', v_existing.expires_at,
      'idempotent', true
    );
  END IF;

  -- 6) Snapshot comercial: precio unitario y total congelados aqui.
  v_amount := v_unit_price * v_count;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'ERR_TRIP_PRICE_MISSING: Computed amount must be positive';
  END IF;

  INSERT INTO public.checkout_attempts (
    trip_id, agency_id, customer_id, seat_ids, passenger_data,
    unit_price, amount_cents, status, idempotency_key, expires_at
  ) VALUES (
    p_trip_id, p_agency_id, p_customer_id, p_seat_ids, p_passenger_data,
    v_unit_price, v_amount, 'created', v_key_ns, v_expires_at
  )
  RETURNING id INTO v_attempt_id;

  -- 7) Ownership explicito de los locks. El WHERE es una guarda
  --    adicional: solo asientos 'locked' todavia sin vincular.
  UPDATE public.seats s
  SET checkout_attempt_id = v_attempt_id
  WHERE s.id = ANY(p_seat_ids)
    AND s.status = 'locked'
    AND s.checkout_attempt_id IS NULL;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  IF v_rowcount <> v_count THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_SEAT_CLAIMED: Seats are already claimed by another checkout attempt';
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'trip_id', p_trip_id,
    'agency_id', p_agency_id,
    'customer_id', p_customer_id,
    'status', 'created',
    'seat_ids', to_jsonb(p_seat_ids),
    'passenger_count', v_count,
    'unit_price', v_unit_price,
    'amount_cents', v_amount,
    'proof_count', 0,
    'expires_at', v_expires_at,
    'idempotent', false
  );
END;
$$;

COMMENT ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) IS
  'MKT-007: crea UN checkout_attempt (status=created) y estampa seats.checkout_attempt_id en la misma transaccion. NO crea reservations ni payments. Verifica trip activo/no partido con precio, agencia ofertada, y ownership de los seats (locked_by=customer, guest_session_id NULL, TTL vigente) con FOR UPDATE; rechaza asientos ya reclamados por OTRO intento. Congela el snapshot de pasajeros (seat_id, first_name, last_name, document, phone) en el MISMO orden que seat_ids. La ventana inicial hereda el TTL restante (900 s) para que el cliente no se prolongue su propia expiracion. Idempotente por set de asientos y por Idempotency-Key. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) TO service_role;
