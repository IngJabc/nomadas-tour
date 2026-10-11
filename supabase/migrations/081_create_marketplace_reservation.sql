-- ============================================================
-- 081_create_marketplace_reservation.sql
-- MKT-004 Fase A — creación atómica de una reserva marketplace
-- (reservations + reservation_passengers) en UNA sola
-- transacción PostgreSQL.
--
-- Contexto:
--   011 creo reservations y reservation_passengers.
--   075 agrego customer_id/source/payment_status y los estados
--     'locked'/'reserved' del ciclo marketplace.
--   076 agrego trips.seat_price y reservation_passengers.unit_price.
--   069/047/066 definieron el patron de RPC transaccional de tour
--     (create_agency_reservation -> create_reservation_core).
--   Este flujo NO puede reutilizar create_reservation_core: ese core
--     inserta status='confirmed', convierte los seats a 'reserved' y
--     limpia lock_expires_at — prohibido para el marketplace en Fase A.
--
-- Reglas de la Fase A (docs/business-rules.md 2, 10, 11):
--   - La reserva se crea con status='locked', source='marketplace',
--     customer_id del usuario autenticado y payment_status='pending'.
--   - NO se modifica ningún asiento: los locks y lock_expires_at
--     permanecen intactos (el TTL no se extiende ni se acorta).
--   - unit_price es snapshot server-side de trips.seat_price; el
--     cliente no puede decidir el precio.
--   - agency_id se verifica contra la relación real trip_agencies.
--   - Idempotencia: repetir el mismo checkout devuelve la reserva
--     existente (misma tanda de seats) sin crear duplicados.
--
-- Migracion marketplace (074-081). Requiere 075 (estados locked,
-- customer_id/source) y 076 (seat_price/unit_price).
-- Fuente de verdad: nomadas-tour-marketplace/docs/business-rules.md.
--
-- NO se toca: tablas, CHECK de seats, policies, RPCs de tour,
-- triggers de outbox, TTL de ninguno de los dos backends.
--
-- Dry-run:   BEGIN;  \i 081_create_marketplace_reservation.sql   ROLLBACK;
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_marketplace_reservation(
  p_trip_id UUID,
  p_customer_id UUID,
  p_agency_id UUID,
  p_seat_ids UUID[],
  p_passenger_names TEXT[],
  p_passenger_documents TEXT[],
  p_passenger_phones TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_trip_status TEXT;
  v_departure TIMESTAMPTZ;
  v_unit_price INTEGER;
  v_destination TEXT;
  v_found_count INTEGER := 0;
  v_seat RECORD;
  v_seen_docs TEXT[] := ARRAY[]::TEXT[];
  v_doc TEXT;
  v_existing_id UUID;
  v_existing_qr TEXT;
  v_existing_ticket CHAR(8);
  v_reservation_id UUID;
  v_ticket_code CHAR(8);
  v_qr_code TEXT;
  v_i INTEGER;
BEGIN
  -- ── 1) Customer autenticado (nunca viene del cliente) ────────
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CUSTOMER_REQUIRED: An authenticated customer is required';
  END IF;

  -- ── 2) Arreglos: exactamente un pasajero por asiento ─────────
  v_count := array_length(p_seat_ids, 1);
  IF v_count IS NULL OR v_count = 0 THEN
    RAISE EXCEPTION 'ERR_NO_SEATS: At least one seat is required';
  END IF;

  IF array_length(p_passenger_names, 1) IS DISTINCT FROM v_count
     OR array_length(p_passenger_documents, 1) IS DISTINCT FROM v_count
     OR array_length(p_passenger_phones, 1) IS DISTINCT FROM v_count THEN
    RAISE EXCEPTION 'ERR_PASSENGER_MISMATCH: Passenger arrays must match seat count';
  END IF;

  IF (SELECT count(*) FROM (SELECT DISTINCT unnest(p_seat_ids) AS id) d) <> v_count THEN
    RAISE EXCEPTION 'ERR_SEAT_DUPLICATE: Duplicated seat in payload';
  END IF;

  FOR v_i IN 1 .. v_count LOOP
    IF p_passenger_documents[v_i] IS NULL OR length(trim(p_passenger_documents[v_i])) = 0 THEN
      RAISE EXCEPTION 'ERR_PASSENGER_DATA: Passenger document is required';
    END IF;
    v_doc := trim(p_passenger_documents[v_i]);
    IF v_doc = ANY(v_seen_docs) THEN
      RAISE EXCEPTION 'ERR_PASSENGER_DUPLICATE_DOCUMENT: Document % is repeated in this reservation', v_doc;
    END IF;
    v_seen_docs := v_seen_docs || v_doc;
  END LOOP;

  -- ── 3) Trip: existe, activo, no partió, con precio ───────────
  SELECT t.status, t.departure_time, t.seat_price, r.destination
    INTO v_trip_status, v_departure, v_unit_price, v_destination
  FROM public.trips t
  LEFT JOIN public.routes r ON r.id = t.route_id
  WHERE t.id = p_trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;
  IF v_trip_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_ACTIVE: Trip is not active';
  END IF;
  IF v_departure <= NOW() THEN
    RAISE EXCEPTION 'ERR_TRIP_DEPARTED: Cannot create a reservation after departure time';
  END IF;
  IF v_unit_price IS NULL THEN
    RAISE EXCEPTION 'ERR_TRIP_PRICE_MISSING: Trip has no seat_price to snapshot';
  END IF;

  -- ── 4) Agencia: relacion real trip -> agency (trip_agencies) ─
  IF NOT EXISTS (
    SELECT 1 FROM public.trip_agencies ta
    WHERE ta.trip_id = p_trip_id AND ta.agency_id = p_agency_id
  ) THEN
    RAISE EXCEPTION 'ERR_AGENCY_NOT_ASSIGNED: The trip is not offered by this agency';
  END IF;

  -- ── 5) Seats: existen, pertenecen al trip y estan bloqueados
  --       por este customer con TTL vigente. Se toman con FOR UPDATE
  --       para serializar checkouts concurrentes. NO se actualiza
  --       ninguna fila: lock_expires_at queda intacto. ──────────
  FOR v_seat IN
    SELECT id, seat_code, status, locked_by, guest_session_id, lock_expires_at
    FROM public.seats
    WHERE trip_id = p_trip_id AND id = ANY(p_seat_ids)
    ORDER BY id
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
  END LOOP;

  IF v_found_count <> v_count THEN
    RAISE EXCEPTION 'ERR_SEAT_NOT_FOUND: One or more seats not found in this trip';
  END IF;

  -- ── 6) Idempotencia: mismo checkout (mismo set de seats) ya
  --       'locked' para este customer -> devolverla sin crear otra.
  --       Seguro bajo concurrencia: este bloque corre con los seats
  --       tomados en FOR UPDATE; una segunda request identica espera
  --       aqui y al continuar ya ve la reserva creada. ──────────
  SELECT r.id, r.qr_code, r.ticket_code
    INTO v_existing_id, v_existing_qr, v_existing_ticket
  FROM public.reservations r
  WHERE r.trip_id = p_trip_id
    AND r.customer_id = p_customer_id
    AND r.source = 'marketplace'
    AND r.status = 'locked'
    AND (SELECT array_agg(rp.seat_id ORDER BY rp.seat_id)
           FROM public.reservation_passengers rp
          WHERE rp.reservation_id = r.id)
      = (SELECT array_agg(u ORDER BY u) FROM unnest(p_seat_ids) u)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reservation_id', v_existing_id,
      'trip_id', p_trip_id,
      'agency_id', p_agency_id,
      'customer_id', p_customer_id,
      'status', 'locked',
      'source', 'marketplace',
      'unit_price', v_unit_price,
      'passenger_count', v_count,
      'seat_ids', to_jsonb(p_seat_ids),
      'qr_code', v_existing_qr,
      'ticket_code', v_existing_ticket,
      'idempotent', true
    );
  END IF;

  -- ── 7) Reservation: marketplace, locked, booker derivado del
  --       primer pasajero (public.users no tiene nombre ni cedula). ─
  v_reservation_id := gen_random_uuid();
  v_ticket_code := UPPER(LEFT(REPLACE(v_reservation_id::text, '-', ''), 8));
  v_qr_code := 'NT-' || UPPER(COALESCE(v_destination, '')) || '-' || UPPER(REPLACE(v_reservation_id::text, '-', ''));

  INSERT INTO public.reservations (
    id, trip_id, agency_id, created_by, customer_id, source, status,
    booker_name, booker_document, booker_phone,
    qr_code, ticket_code, payment_status
  ) VALUES (
    v_reservation_id, p_trip_id, p_agency_id, p_customer_id, p_customer_id,
    'marketplace', 'locked',
    trim(p_passenger_names[1]), trim(p_passenger_documents[1]),
    NULLIF(trim(p_passenger_phones[1]), ''),
    v_qr_code, v_ticket_code, 'pending'
  );

  -- ── 8) Pasajeros: exactamente uno por seat, con el snapshot
  --       server-side de trips.seat_price en unit_price. ────────
  FOR v_i IN 1 .. v_count LOOP
    INSERT INTO public.reservation_passengers (
      reservation_id, seat_id, name, document, phone, unit_price
    ) VALUES (
      v_reservation_id,
      p_seat_ids[v_i],
      trim(p_passenger_names[v_i]),
      trim(p_passenger_documents[v_i]),
      NULLIF(trim(p_passenger_phones[v_i]), ''),
      v_unit_price
    );
  END LOOP;

  -- ── 9) NO se tocan los seats: el lock sigue vigente con su
  --       lock_expires_at original hasta que el pago o el cleanup
  --       decidan lo demas (MKT-005+). ──────────────────────────

  RETURN jsonb_build_object(
    'reservation_id', v_reservation_id,
    'trip_id', p_trip_id,
    'agency_id', p_agency_id,
    'customer_id', p_customer_id,
    'status', 'locked',
    'source', 'marketplace',
    'unit_price', v_unit_price,
    'passenger_count', v_count,
    'seat_ids', to_jsonb(p_seat_ids),
    'qr_code', v_qr_code,
    'ticket_code', v_ticket_code,
    'idempotent', false
  );
END;
$$;

COMMENT ON FUNCTION public.create_marketplace_reservation(UUID, UUID, UUID, UUID[], TEXT[], TEXT[], TEXT[]) IS
  'MKT-004 Fase A: crea UNA reserva marketplace (status=locked, source=marketplace, customer_id del auth) y sus reservation_passengers con unit_price=trips.seat_price en la misma transaccion. Verifica trip activo/no partido, agencia ofertada (trip_agencies), ownership de los seats (locked_by=customer, guest_session_id NULL, TTL vigente) con FOR UPDATE y NO modifica seats ni lock_expires_at. Idempotente por mismo set de seats. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.create_marketplace_reservation(UUID, UUID, UUID, UUID[], TEXT[], TEXT[], TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_marketplace_reservation(UUID, UUID, UUID, UUID[], TEXT[], TEXT[], TEXT[]) FROM anon;
REVOKE ALL ON FUNCTION public.create_marketplace_reservation(UUID, UUID, UUID, UUID[], TEXT[], TEXT[], TEXT[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_marketplace_reservation(UUID, UUID, UUID, UUID[], TEXT[], TEXT[], TEXT[]) TO service_role;
