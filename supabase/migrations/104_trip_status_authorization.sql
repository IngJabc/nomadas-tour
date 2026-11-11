-- ============================================================
-- 104_trip_status_authorization.sql
--
-- Autorizacion + guarda de reservas para los transiciones de
-- estado de un viaje (complete / cancel) via public.set_trip_status.
--
-- Reglas de negocio confirmadas:
--   * El actor se deriva del usuario autenticado y su rol / agency
--     se leen de public.users. Nunca se confia en un rol declarado
--     por el cliente (p_actor_user_id es solo la identidad).
--   * Superadmin: completa o cancela cualquier viaje elegible.
--   * Agency: solo COMPLETA viajes asignados en exclusiva (exactamente
--     una fila en trip_agencies y esa fila es la suya). No cancela
--     viajes completos y no archiva.
--   * Cancelar un viaje mientras existan reservas vivas esta
--     prohibido: todavia no existe el flujo de reembolsos.
--   * 'archived' sigue siendo superadmin-only (route + service) y
--     NO se agrega ningun status 'inactive'.
--
-- Atomicidad de la guarda de reservas:
--   * La guarda corre en la MISMA transaccion que el UPDATE de trips,
--     despues de tomar el lock FOR UPDATE de la fila del viaje.
--   * El trigger reservations_trip_status_guard toma un lock FOR SHARE
--     sobre el viaje en cada INSERT de reserva. Asi una reserva
--     concurrente no puede colarse entre la guarda y el COMMIT de la
--     cancelacion: el INSERT espera el lock (y luego ve el viaje
--     cancelado y falla), o el cancel espera el lock del INSERT (y
--     entonces la guarda ya ve la reserva y aborta con
--     ERR_TRIP_HAS_RESERVATIONS). En cualquier caso no queda un viaje
--     cancelado con una reserva nueva.
--   * Todas las rutas de creacion de reservas (066
--     create_agency_reservation, 081 create_marketplace_reservation,
--     087/090 verify_checkout_attempt) ya exigen trip.status =
--     'active', por lo que el trigger no agrega una restriccion nueva
--     al flujo legítimo.
--
-- CREATE OR REPLACE / DROP IF EXISTS: no modifica migraciones previas.
-- No agrega tablas, columnas ni env vars.
-- ============================================================

DROP FUNCTION IF EXISTS public.set_trip_status(UUID, TEXT, UUID);

CREATE FUNCTION public.set_trip_status(
  p_trip_id UUID,
  p_status TEXT,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_actor public.users%ROWTYPE;
  v_agency_ids UUID[];
  v_active_reservations INTEGER;
BEGIN
  -- ── 1) Status destino valido ───────────────────────────────
  IF p_status NOT IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'ERR_INVALID_STATUS: status must be cancelled or completed';
  END IF;

  -- ── 2) Actor obligatorio y verificado contra public.users ─
  --      El rol se resuelve en la BD: el cliente no puede declararse
  --      superadmin ni apropiarse de otra agencia.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_ACTOR_REQUIRED: actor autenticado requerido';
  END IF;

  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ACTOR_NOT_FOUND: actor no registrado';
  END IF;

  IF v_actor.role NOT IN ('superadmin', 'agency') THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN_ROLE: rol % no puede cambiar el estado de un viaje', v_actor.role;
  END IF;

  -- ── 3) Lock de la fila del viaje (serializa con el trigger de
  --       reservas y con transiciones concurrentes) ────────────
  SELECT * INTO v_trip FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;

  -- ── 4) Estados y ventanas de salida (sin cambios) ──────────
  IF v_trip.status = 'archived' THEN
    RAISE EXCEPTION 'ERR_TRIP_ARCHIVED: No se puede modificar un viaje archivado';
  END IF;

  IF v_trip.status <> 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_ACTIVE: Trip is not active';
  END IF;

  IF p_status = 'completed' THEN
    IF NOW() < v_trip.departure_time THEN
      RAISE EXCEPTION 'ERR_TRIP_NOT_DEPARTED: Cannot complete a trip before its departure time';
    END IF;
  ELSIF p_status = 'cancelled' THEN
    IF NOW() >= v_trip.departure_time THEN
      RAISE EXCEPTION 'ERR_TRIP_DEPARTED: Cannot cancel a trip after its departure time';
    END IF;
  END IF;

  -- ── 5) Regla de agencia: solo completar viajes exclusivos ──
  IF v_actor.role = 'agency' THEN
    IF p_status <> 'completed' THEN
      RAISE EXCEPTION 'ERR_AGENCY_CANNOT_CANCEL: Las agencias no pueden cancelar un viaje';
    END IF;

    SELECT COALESCE(array_agg(agency_id ORDER BY agency_id), '{}'::uuid[])
    INTO v_agency_ids
    FROM trip_agencies
    WHERE trip_id = p_trip_id;

    IF array_length(v_agency_ids, 1) IS DISTINCT FROM 1
       OR v_agency_ids[1] IS DISTINCT FROM v_actor.agency_id THEN
      RAISE EXCEPTION 'ERR_TRIP_NOT_EXCLUSIVE: El viaje no pertenece en exclusiva a esta agencia';
    END IF;
  END IF;

  -- ── 6) Guarda de cancelacion: sin reservas vivas ───────────
  --      'reservas vivas' = toda reserva que no este cancelada
  --      (confirmed / partial / locked / reserved / completed /
  --      boarded). Reembolsos todavia no existen.
  IF p_status = 'cancelled' THEN
    SELECT count(*) INTO v_active_reservations
    FROM reservations
    WHERE trip_id = p_trip_id
      AND status <> 'cancelled';

    IF v_active_reservations > 0 THEN
      RAISE EXCEPTION 'ERR_TRIP_HAS_RESERVATIONS: No se puede cancelar un viaje con % reserva(s) activa(s). El reembolso aun no esta implementado', v_active_reservations;
    END IF;
  END IF;

  -- ── 7) Transicion ──────────────────────────────────────────
  UPDATE trips
  SET status = p_status,
      updated_by = p_actor_user_id
  WHERE id = p_trip_id;

  -- ── 8) Liberacion de asientos al cancelar ──────────────────
  IF p_status = 'cancelled' THEN
    UPDATE seats
    SET status = 'available',
        locked_by = NULL,
        locked_at = NULL,
        lock_expires_at = NULL
    WHERE trip_id = p_trip_id
      AND status IN ('locked', 'reserved', 'blocked');
  END IF;

  -- ── 9) Evento outbox (dedup_key trip.<status>:<trip_id>) ───
  SELECT COALESCE(array_agg(agency_id ORDER BY agency_id), '{}'::uuid[])
  INTO v_agency_ids
  FROM trip_agencies
  WHERE trip_id = p_trip_id;

  PERFORM public.emit_trip_event(
    'trip.' || p_status,
    p_trip_id,
    jsonb_build_object(
      'trip_id', p_trip_id,
      'route_id', v_trip.route_id,
      'departure_time', v_trip.departure_time,
      'status', p_status,
      'agency_ids', to_jsonb(v_agency_ids)
    ),
    'trip.' || p_status || ':' || p_trip_id::text
  );

  RETURN jsonb_build_object('trip_id', p_trip_id, 'status', p_status);
END;
$$;

COMMENT ON FUNCTION public.set_trip_status(UUID, TEXT, UUID) IS
  'WKR-007 + F5-001 + DISC-AS: trip cancelled/completed + seat release + outbox, con autorizacion por rol (superadmin / agencia exclusiva) y guarda de reservas vivas en la cancelacion. El rol y la agencia se resuelven en public.users; nunca se confia en el llamante. EXECUTE service_role only.';

-- Mismos privilegios que en 065: el RPC sigue siendo invocable solo
-- desde el backend (service_role). La autorizacion de rol/agencia vive
-- DENTRO de la funcion, de modo que el camino service_role no la evita.
REVOKE EXECUTE ON FUNCTION public.set_trip_status(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_trip_status(UUID, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_trip_status(UUID, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_trip_status(UUID, TEXT, UUID) TO service_role;

-- ============================================================
-- Guarda de creacion de reservas contra cancelacion concurrente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.block_reservation_on_inactive_trip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  -- Lock compartido de la fila del viaje: serializa contra
  -- set_trip_status (FOR UPDATE) sin serializar checkouts entre si.
  SELECT status INTO v_status
  FROM public.trips
  WHERE id = NEW.trip_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;

  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_ACTIVE: Cannot create a reservation for a trip that is not active';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.block_reservation_on_inactive_trip() IS
  'DISC-AS: BEFORE INSERT en reservations. Toma FOR SHARE sobre el viaje y rechaza reservas en viajes que no estan active, cerrando la carrera entre una cancelacion de viaje y una creacion de reserva concurrente.';

DROP TRIGGER IF EXISTS reservations_trip_status_guard ON public.reservations;

CREATE TRIGGER reservations_trip_status_guard
  BEFORE INSERT ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.block_reservation_on_inactive_trip();
