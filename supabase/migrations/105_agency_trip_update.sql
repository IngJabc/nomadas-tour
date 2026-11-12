-- ============================================================
-- 105_agency_trip_update.sql
-- AS-TRIP-004 — edicion de viajes propios por la agencia.
--
-- Reglas de negocio confirmadas:
--   * Solo el rol 'agency' (leido de public.users, nunca declarado
--     por el cliente) puede usar este RPC; la agencia del actor TAMBIEN
--     sale de public.users, no de un parametro: no existe forma de
--     apropiarse de un viaje ajeno via body, query ni headers.
--   * El viaje debe estar asignado en EXCLUSIVA a la agencia del actor
--     (exactamente una fila en trip_agencies y esa fila es la suya):
--     los viajes compartidos quedan bloqueados.
--   * Solo viajes 'active' (archivados, completados y cancelados no).
--   * Cero reservas: cualquier reserva registrada —incluida la
--     cancelada— bloquea la edicion en este incremento. Modificar
--     reservas, asientos, pagos o pasajeros queda fuera de alcance.
--   * La ruta debe existir y estar 'active' (las rutas siguen siendo
--     GLOBALES: este RPC no las crea ni las edita).
--   * La salida debe permanecer en el futuro.
--
-- Por que es necesaria una migracion nueva (atomicidad):
--   * La guarda "sin reservas" debe correr en la MISMA transaccion que
--     el UPDATE, bajo lock de la fila del viaje. Un chequeo en la capa
--     de servicio (SELECT ... luego UPDATE en transacciones separadas)
--     deja una ventana en la que una reserva concurrente se coloca
--     entre el chequeo y la escritura.
--   * Serializacion con reservas: el trigger 104
--     reservations_trip_status_guard toma FOR SHARE sobre el viaje en
--     CADA INSERT de reserva. Este RPC toma FOR UPDATE, asi que:
--       - si la reserva llega primero, el UPDATE espera el lock y aqui
--         se ve la reserva -> ERR_TRIP_HAS_RESERVATIONS (no se edita);
--       - si este RPC llega primero, el INSERT espera nuestro COMMIT y
--         la edicion termina antes de que exista la reserva.
--     En ningun caso queda un viaje editado "a cero reservas" con una
--     reserva colada durante la edicion.
--   * update_trip (084) ya validado vehiculo/capacidad, precio,
--     UNIQUE(route_id, departure_time) y reajusta asientos dentro de su
--     propia transaccion; se reutiliza en lugar de duplicar esa logica
--     (tambien emite el evento trip.updated via outbox, igual que la
--     edicion del superadmin).
--   * La asignacion se pasa IDENTICA (ARRAY[agencia del actor]) para
--     que update_trip no reescriba trip_agencies: la agencia no puede
--     cambiar la asignacion del viaje. p_postpone=FALSE: la edicion
--     nunca toca postponed_from ni emite trip.postponed.
--
-- CREATE OR REPLACE: no modifica migraciones previas. No agrega tablas,
-- columnas, politicas RLS ni env vars.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_agency_trip(
  p_trip_id UUID,
  p_route_id UUID,
  p_departure_time TIMESTAMPTZ,
  p_vehicle_type TEXT,
  p_actor_user_id UUID,
  p_seat_price INTEGER DEFAULT NULL
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
  v_reservation_count INTEGER;
  v_route public.routes%ROWTYPE;
BEGIN
  -- ── 1) Precio por asiento: entero no negativo en centavos ──
  IF p_seat_price IS NOT NULL AND p_seat_price < 0 THEN
    RAISE EXCEPTION 'ERR_INVALID_SEAT_PRICE: seat_price must be a non-negative integer in cents';
  END IF;

  -- ── 2) Actor obligatorio, verificado contra public.users ───
  --      El rol y la agencia se resuelven en la BD: el cliente no
  --      puede declararse superadmin ni apropiarse de otra agencia.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_ACTOR_REQUIRED: actor autenticado requerido';
  END IF;

  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ACTOR_NOT_FOUND: actor no registrado';
  END IF;

  IF v_actor.role <> 'agency' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN_ROLE: rol % no puede editar viajes desde el panel de agencia', v_actor.role;
  END IF;

  IF v_actor.agency_id IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN_ROLE: el usuario no tiene una agencia asociada';
  END IF;

  -- ── 3) Lock de la fila del viaje (FOR UPDATE) ──────────────
  --      Serializa con el trigger de reservas (104, FOR SHARE), con
  --      transiciones de estado (104 set_trip_status) y con ediciones
  --      concurrentes (incluida la del superadmin via update_trip).
  SELECT * INTO v_trip FROM trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;

  -- ── 4) Solo viajes activos ─────────────────────────────────
  IF v_trip.status <> 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_ACTIVE: Trip is not active';
  END IF;

  -- ── 5) Exclusividad: exactamente UNA asignacion y es la del
  --      actor. Los viajes compartidos (o ajenos) quedan fuera. ─
  SELECT COALESCE(array_agg(agency_id ORDER BY agency_id), '{}'::uuid[])
  INTO v_agency_ids
  FROM trip_agencies
  WHERE trip_id = p_trip_id;

  IF array_length(v_agency_ids, 1) IS DISTINCT FROM 1
     OR v_agency_ids[1] IS DISTINCT FROM v_actor.agency_id THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_EXCLUSIVE: El viaje no pertenece en exclusiva a esta agencia';
  END IF;

  -- ── 6) Guarda transaccional de reservas ────────────────────
  --      Cuenta TODAS las reservas (sin filtro de status): si existe
  --      al menos una fila, el viaje no es editable en este incremento.
  --      Corre con el lock de la seccion 3 tomado, es decir dentro de
  --      la misma transaccion que la actualizacion posterior.
  SELECT count(*) INTO v_reservation_count
  FROM reservations
  WHERE trip_id = p_trip_id;

  IF v_reservation_count > 0 THEN
    RAISE EXCEPTION 'ERR_TRIP_HAS_RESERVATIONS: No se puede editar un viaje con % reserva(s) registrada(s)', v_reservation_count;
  END IF;

  -- ── 7) Ruta global existente y activa ──────────────────────
  SELECT * INTO v_route FROM routes WHERE id = p_route_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ROUTE_NOT_FOUND: Route not found';
  END IF;

  IF v_route.status <> 'active' THEN
    RAISE EXCEPTION 'ERR_ROUTE_INACTIVE: No se puede editar un viaje con una ruta inactiva. Activa la ruta primero.';
  END IF;

  -- ── 8) La salida debe permanecer en el futuro ──────────────
  IF p_departure_time <= NOW() THEN
    RAISE EXCEPTION 'ERR_DEPARTURE_NOT_FUTURE: La fecha y hora de salida debe ser posterior a la fecha y hora actual';
  END IF;

  -- ── 9) Delega en update_trip (084) ─────────────────────────
  --      Reutiliza: tipo de vehiculo soportado + capacidad, ajuste de
  --      asientos, precio, UNIQUE(route_id, departure_time) ->
  --      ERR_TRIP_DUPLICATE, eventos outbox y updated_by para auditoria.
  --      La agencia se pasa identica para no alterar trip_agencies.
  RETURN public.update_trip(
    p_trip_id,
    p_route_id,
    p_departure_time,
    p_vehicle_type,
    ARRAY[v_actor.agency_id],
    FALSE,
    p_actor_user_id,
    p_seat_price
  );
END;
$$;

COMMENT ON FUNCTION public.update_agency_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID, INTEGER) IS
  'AS-TRIP-004: edicion de un viaje propio y exclusivo por parte de una agencia (ruta activa, salida futura, vehiculo y precio). Actor y agencia se resuelven en public.users; exige status active, UNA sola asignacion (trip_agencies) y CERO reservas, todo bajo FOR UPDATE en la misma transaccion que el UPDATE; delega en update_trip con la asignacion sin cambios (p_postpone=FALSE). EXECUTE service_role only.';

-- ── EXECUTE grants (service_role only, misma posture 084/104) ──
REVOKE EXECUTE ON FUNCTION public.update_agency_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_agency_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_agency_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_agency_trip(UUID, UUID, TIMESTAMPTZ, TEXT, UUID, INTEGER) TO service_role;
