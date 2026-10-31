-- ============================================================
-- 096_checkout_trip_published_check.sql
-- TRIP-PUB-001.2 - Validacion transaccional de publicacion en checkout.
--
-- Contexto:
--   095 agrego trips.is_published (visibilidad en el Marketplace,
--   independiente del estado operativo). TRIP-PUB-001 ya filtra el
--   catalogo/detalle y añade un pre-chequeo en el backend
--   (checkout.service.ts), pero el RPC create_checkout_attempt (087)
--   NO conoce la columna y leia la fila del viaje SIN FOR UPDATE:
--   una despublicacion concurrente podia intercalarse entre el
--   pre-chequeo del backend y la escritura del intento (carrera
--   documentada en TRIP-PUB-001).
--
-- Cambio (reemplaza UNICAMENTE create_checkout_attempt):
--   1) El SELECT del viaje ahora lee t.is_published y usa FOR UPDATE:
--      la fila del viaje queda bloqueada hasta el fin de la
--      transaccion. Un UPDATE concurrente de is_published (o de
--      cualquier otra columna de la fila) espera a que este checkout
--      termine; si el viaje ya estaba despublicado al adquirir el
--      lock, se rechaza con ERR_TRIP_NOT_PUBLISHED.
--   2) Nueva validacion ERR_TRIP_NOT_PUBLISHED inmediatamente despues
--      de la de estado (status manda primero: los viajes no activos
--      conservan exactamente su error actual).
--   3) COMMENT de la funcion actualizado para describir la garantia.
--
-- NO cambia (identico a 087, byte a byte en el cuerpo):
--   firma ni tipos de argumentos, RETURNS JSONB, SECURITY DEFINER,
--   SET search_path, REVOKE/GRANT (EXECUTE solo service_role),
--   idempotencia 5b (por set de asientos) y 5c (por Idempotency-Key),
--   validaciones de cliente, agencia, asientos, vencimiento y precio,
--   INSERT de checkout_attempts, estampado de seats.checkout_attempt_id
--   y todos los RAISE (manejo de errores).
--
-- Orden de locks (sin ciclos):
--   trips FOR UPDATE (paso 3) -> seats FOR UPDATE ORDER BY id (paso 5).
--   - Ningun otro flujo del esquema toma FOR UPDATE sobre public.trips
--     (los flujos de seats del marketplace usan sentencias PostgREST
--     auto-commit y verify/reject/cancel bloquean checkout_attempts,
--     no trips), por lo que el lock de trips no puede formar parte de
--     un ciclo.
--   - La despublicacion (UPDATE public.trips) solo necesita el lock de
--     la fila de trips: espera a los checkouts en vuelo y se serializa
--     detras de ellos.
--   - Coste: dos checkouts concurrentes del MISMO viaje se serializan
--     desde el paso 3 (antes solo lo hacian en los asientos). Transaccion
--     corta; impacto despreciable.
--
-- Compatibilidad:
--   - verify_checkout_attempt, submit_checkout_proof, reject y cancel
--     NO se modifican: los intentos ya creados siguen verificables,
--     reintentables y cancelables aunque el viaje se despublique.
--   - Reservas, pasajeros, pagos, allocations, tickets QR y boarding
--     existentes no se tocan; trips.status jamas se escribe.
--   - El pre-chequeo del backend se CONSERVA como respuesta temprana
--     (409 sin invocar el RPC), pero la garantia de integridad vive
--     AQUI, dentro de la transaccion.
--
-- PRECONDICION DE DESPLIEGUE: 095 debe estar aplicada ANTES (la
-- columna is_published debe existir; CREATE OR REPLACE la referencia
-- y fallaria si no existe). Orden: 095 -> 096 -> deploy backend.
--
-- Dry-run:   BEGIN;  \i 096_checkout_trip_published_check.sql   ROLLBACK;
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
  v_trip_is_published BOOLEAN;
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

  -- 3) Trip: existe, activo, PUBLICADO en el Marketplace, no partio,
  --    con precio. FOR UPDATE es la garantia transaccional de
  --    TRIP-PUB-001.2: bloquea la fila del viaje durante toda la
  --    transaccion, de modo que una despublicacion concurrente
  --    (UPDATE public.trips SET is_published = false) espera aqui
  --    mismo. Si la fila ya llego despublicada, se rechaza antes de
  --    tocar asientos o crear el intento.
  SELECT t.status, t.departure_time, t.seat_price, t.is_published
    INTO v_trip_status, v_departure, v_unit_price, v_trip_is_published
  FROM public.trips t
  WHERE t.id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;
  IF v_trip_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_ACTIVE: Trip is not active';
  END IF;
  -- TRIP-PUB-001 (095): visibilidad, NO estado operativo. Se valida
  -- despues de status para conservar exactamente los errores actuales
  -- de los viajes no activos. IS DISTINCT FROM true tolera NULL en
  -- entornos donde la columna exista sin NOT NULL.
  IF v_trip_is_published IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_PUBLISHED: Trip is not published in the Marketplace';
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
  'MKT-007 + TRIP-PUB-001.2: crea UN checkout_attempt (status=created) y estampa seats.checkout_attempt_id en la misma transaccion. NO crea reservations ni payments. Verifica trip activo, PUBLICADO en el Marketplace (is_published, 095, leido con FOR UPDATE sobre la fila del viaje: una despublicacion concurrente se serializa y no puede habilitar un checkout nuevo), no partido, con precio, agencia ofertada, y ownership de los seats (locked_by=customer, guest_session_id NULL, TTL vigente) con FOR UPDATE; rechaza asientos ya reclamados por OTRO intento. Congela el snapshot de pasajeros (seat_id, first_name, last_name, document, phone) en el MISMO orden que seat_ids. La ventana inicial hereda el TTL restante (900 s) para que el cliente no se prolongue su propia expiracion. Idempotente por set de asientos y por Idempotency-Key. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) TO service_role;
