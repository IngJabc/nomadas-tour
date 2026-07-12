-- ============================================================
-- 014_agency_reservation_function.sql
-- Stored procedure atomica para crear reservas de agencia.
-- Usa FOR UPDATE para evitar race conditions y una transaccion
-- unica que garantiza consistencia.
-- ============================================================

CREATE OR REPLACE FUNCTION create_agency_reservation(
  p_trip_id UUID,
  p_agency_id UUID,
  p_created_by UUID,
  p_booker_name TEXT,
  p_booker_document TEXT,
  p_booker_phone TEXT,
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
  v_reservation_id UUID;
  v_qr_code TEXT;
  v_destination TEXT;
  v_seat RECORD;
  v_i INTEGER;
  v_found_count INTEGER;
BEGIN
  -- 1. Validar que el viaje existe y esta activo
  IF NOT EXISTS (SELECT 1 FROM trips WHERE id = p_trip_id AND status = 'active') THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found or not active';
  END IF;

  -- 2. Validar que la agencia esta asignada al viaje
  IF NOT EXISTS (SELECT 1 FROM trip_agencies WHERE trip_id = p_trip_id AND agency_id = p_agency_id) THEN
    RAISE EXCEPTION 'ERR_AGENCY_NOT_ASSIGNED: Your agency is not assigned to this trip';
  END IF;

  -- 3. Validar cantidad de arrays
  IF array_length(p_seat_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'ERR_NO_SEATS: At least one seat is required';
  END IF;

  IF array_length(p_passenger_names, 1) != array_length(p_seat_ids, 1)
    OR array_length(p_passenger_documents, 1) != array_length(p_seat_ids, 1)
    OR array_length(p_passenger_phones, 1) != array_length(p_seat_ids, 1)
  THEN
    RAISE EXCEPTION 'ERR_PASSENGER_MISMATCH: Passenger arrays must match seat count';
  END IF;

  -- 4. Validar que todos los asientos pertenecen al viaje y BLOQUEARLOS
  --    FOR UPDATE evita que otra transaccion modifique estas filas
  --    mientras esta transaccion esta en progreso
  --    Se permiten asientos locked por el mismo usuario (p_created_by)
  v_found_count := 0;
  FOR v_seat IN
    SELECT id, seat_code, status, locked_by
    FROM seats
    WHERE trip_id = p_trip_id AND id = ANY(p_seat_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    v_found_count := v_found_count + 1;

    IF NOT (v_seat.status = 'available' OR (v_seat.status = 'locked' AND v_seat.locked_by = p_created_by)) THEN
      RAISE EXCEPTION 'ERR_SEAT_UNAVAILABLE: Seat % is not available (status: %)',
        v_seat.seat_code, v_seat.status;
    END IF;
  END LOOP;

  IF v_found_count != array_length(p_seat_ids, 1) THEN
    RAISE EXCEPTION 'ERR_SEAT_NOT_FOUND: One or more seats not found in this trip';
  END IF;

  -- 5. Obtener destino para el QR
  SELECT r.destination INTO v_destination
  FROM trips t
  JOIN routes r ON r.id = t.route_id
  WHERE t.id = p_trip_id;

  -- 6. Crear la reserva (cabecera del grupo)
  v_reservation_id := gen_random_uuid();
  v_qr_code := 'NT-' || UPPER(COALESCE(v_destination, '')) || '-' || UPPER(REPLACE(v_reservation_id::TEXT, '-', ''));

  INSERT INTO reservations (id, trip_id, agency_id, created_by, booker_name, booker_document, booker_phone, qr_code, status)
  VALUES (v_reservation_id, p_trip_id, p_agency_id, p_created_by, p_booker_name, p_booker_document,
    NULLIF(p_booker_phone, ''), v_qr_code, 'confirmed');

  -- 7. Insertar pasajeros
  FOR v_i IN 1 .. array_length(p_seat_ids, 1) LOOP
    INSERT INTO reservation_passengers (reservation_id, seat_id, name, document, phone)
    VALUES (v_reservation_id, p_seat_ids[v_i], p_passenger_names[v_i], p_passenger_documents[v_i],
      NULLIF(p_passenger_phones[v_i], ''));
  END LOOP;

  -- 8. Bloquear asientos (reservados)
  UPDATE seats
  SET status = 'reserved', updated_at = NOW()
  WHERE trip_id = p_trip_id AND id = ANY(p_seat_ids);

  -- 9. Retornar resultado
  RETURN jsonb_build_object(
    'reservation_id', v_reservation_id,
    'qr_code', v_qr_code
  );
END;
$$;
