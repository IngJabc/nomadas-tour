-- ============================================================
-- 106_two_part_payments.sql
-- MKT-010.1 - Pagos de reserva en DOS partes: deposito fijo +
--             saldo restante.
--
-- Reglas de negocio confirmadas (MKT-010.1):
--   * Exactamente DOS etapas: (1) deposito fijo por pasajero,
--     configurado por la agencia con vencimiento; (2) saldo =
--     total - deposito, con vencimiento normalmente el dia antes
--     o el dia de la salida. Sin terceras etapas ni cuotas.
--   * La agencia se comunica con el cliente por WhatsApp
--     reutilizando la funcionalidad existente.
--   * El sistema calcula montos y porcentajes DEL LADO DEL
--     SERVIDOR; el cliente nunca envia importes.
--   * Un pago jamas se aprueba dos veces, no se admite
--     sobrepago y los totales nunca quedan inconsistentes.
--   * NUNCA se cancela automaticamente una reserva por saldo
--     vencido: la decision es de la agencia. Los asientos
--     permanecen reservados esperando el saldo.
--   * fully_paid solo cuando AMBAS etapas estan verificadas.
--
-- Que agrega esta migracion (aditiva; 001-105 no se tocan):
--   1) trips.deposit_deadline / trips.balance_deadline (juntos o
--      ninguno; deposito <= saldo).
--   2) checkout_attempts.payment_plan ('single'|'two_stage') y
--      checkout_attempts.deposit_cents (snapshot del importe del
--      deposito del intento). Reutiliza 078
--      trips.installment_allowed / installment_amount_cents como
--      CONFIG de la agencia (no como snapshot de pagos).
--   3) payments.stage ('full'|'deposit'|'balance').
--   4) audit_log_action_check + 'payment.submitted' (patron guard).
--   5) RPC set_trip_payment_plan: la agencia habilita/deshabilita
--      el plan de dos partes de UN viaje propio y exclusivo.
--   6) RPC create_checkout_attempt REEMPLAZADA (copia de 096): el
--      plan se calcula server-side desde la fila del viaje; el
--      importe del intento pasa a ser el DEPOSITO cuando el plan
--      es two_stage.
--   7) RPC verify_checkout_attempt REEMPLAZADA (copia de 087):
--      aprueba el DEPOSITO (payment stage='deposit', reserva
--      payment_status='partial') o el pago total (legado).
--   8) RPC verify_marketplace_payment REEMPLAZADA (copia de 085):
--      verifica stage='balance' contra el saldo exacto restante
--      (impide sobrepago) y stage='full' tal cual 085.
--   9) RPC reject_marketplace_payment REEMPLAZADA (copia de 085):
--      un pago de saldo NUNCA cancela la reserva ni libera
--      asientos; el camino de cancelacion queda solo para el
--      pago total legado (stage='full').
--  10) RPC submit_reservation_balance_payment: el cliente somete
--      el comprobante del SALDO (importes server-side).
--  11) RPC reservation_payment_progress: progreso de pago para
--      el cliente (y para la agencia sin customer_id).
--
-- Los vencimientos se LEEN EN VIVO de la viaja (no se copian al
-- intento ni a la reserva): la agencia puede ajustarlos p. ej. al
-- postergar un viaje. El IMPORTE del deposito si se congela en
-- checkout_attempts.deposit_cents al crear el intento.
--
-- Por que una migracion nueva y no tocar 078/085/087/096:
--   Son historicas y ya aplicadas en el proyecto Supabase
--   compartido: se leen, no se reescriben. Las RPCs vigentes se
--   sustituyen aqui con CREATE OR REPLACE sobre su version ACTUAL
--   (create=096, verify_checkout=087, verify/reject_payment=085),
--   preservando su cuerpo y agregando unicamente la logica de
--   dos partes.
--
-- Migrations marketplace 074-106. Requiere 065 (audit_append),
-- 076 (payments/allocations), 078 (installment_*), 083/085/087
-- (pagos marketplace), 091 (agency_contacts), 096 (create
-- vigente), 099 (CHECK de auditoria vigente) y 105 (patron de
-- autorizacion de agencia) ya aplicadas.
--
-- REGLA DEL REPO: dry-run obligatorio antes de aplicar:
--   BEGIN; \i 106_two_part_payments.sql; ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) Schema (aditivo)
-- ============================================================

-- 1a) Vencimientos del plan en la viaja. Ambos o ninguno, y el
--     del deposito nunca puede ser posterior al del saldo.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS deposit_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS balance_deadline TIMESTAMPTZ;

ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_payment_deadlines_check;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_payment_deadlines_check CHECK (
    (deposit_deadline IS NULL AND balance_deadline IS NULL)
    OR (
      deposit_deadline IS NOT NULL
      AND balance_deadline IS NOT NULL
      AND deposit_deadline <= balance_deadline
    )
  );

COMMENT ON COLUMN public.trips.deposit_deadline IS
  'MKT-010.1: vencimiento del deposito (etapa 1). NULL = plan de dos partes deshabilitado. Se lee en vivo: la agencia puede ajustarlo.';
COMMENT ON COLUMN public.trips.balance_deadline IS
  'MKT-010.1: vencimiento del saldo (etapa 2), normalmente dia antes o dia de la salida. NULL = plan deshabilitado. Informativo: nunca dispara cancelacion automatica.';

-- 1b) Plan por intento de compra + snapshot del deposito.
--     Legado: 'single' + deposit_cents NULL (los intentos previos
--     cumplen la coherencia sin data migration).
ALTER TABLE public.checkout_attempts
  ADD COLUMN IF NOT EXISTS payment_plan TEXT NOT NULL DEFAULT 'single';

ALTER TABLE public.checkout_attempts
  DROP CONSTRAINT IF EXISTS checkout_attempts_payment_plan_check;
ALTER TABLE public.checkout_attempts
  ADD CONSTRAINT checkout_attempts_payment_plan_check
  CHECK (payment_plan IN ('single', 'two_stage'));

ALTER TABLE public.checkout_attempts
  ADD COLUMN IF NOT EXISTS deposit_cents INTEGER;

ALTER TABLE public.checkout_attempts
  DROP CONSTRAINT IF EXISTS checkout_attempts_deposit_cents_check;
ALTER TABLE public.checkout_attempts
  ADD CONSTRAINT checkout_attempts_deposit_cents_check CHECK (
    (payment_plan = 'single' AND deposit_cents IS NULL)
    OR (payment_plan = 'two_stage' AND deposit_cents > 0)
  );

COMMENT ON COLUMN public.checkout_attempts.payment_plan IS
  'MKT-010.1: single = pago total (legado); two_stage = deposito fijo + saldo. Se calcula server-side al crear el intento.';
COMMENT ON COLUMN public.checkout_attempts.deposit_cents IS
  'MKT-010.1: deposito TOTAL del intento (importe por pasajero x pasajeros) cuando payment_plan=two_stage; NULL en single. amount_cents refleja este importe en two_stage.';

-- 1c) Etapa de cada pago.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'full';

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_stage_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_stage_check
  CHECK (stage IN ('full', 'deposit', 'balance'));

COMMENT ON COLUMN public.payments.stage IS
  'MKT-010.1: full = pago unico (legado); deposit = etapa 1 verificada con el intento; balance = etapa 2 (saldo).';

-- ============================================================
-- 2) audit_log: ampliacion ADITIVA del CHECK de acciones
--    (patron guard de 079/086/087/089/091/099).
--    Estado VIVO previo: 099 (31 acciones). 106 solo AGREGA
--    'payment.submitted' (envio de comprobante de saldo).
-- ============================================================

DO $$
DECLARE
  v_current TEXT;
  v_lit TEXT;
  v_known TEXT[] := ARRAY[
    'trip.created',
    'trip.updated',
    'trip.cancelled',
    'reservation.created',
    'reservation.cancelled',
    'boarding.board',
    'boarding.unboard',
    'agency_settings.updated',
    'notification_preferences.updated',
    'reservation_link.created',
    'reservation_link.cancelled',
    'reservation_link.confirmed',
    'reservation_link.regenerated',
    'reservation_link.passenger_data_saved',
    'reservation_link.expired',
    'reservation.passenger_cancelled',
    'payment.verified',
    'payment.rejected',
    'payment.submitted',
    'checkout.verified',
    'checkout.rejected',
    'checkout.expired',
    'checkout.cancelled',
    'agency_payment_method.created',
    'agency_payment_method.updated',
    'agency_payment_method.primary_set',
    'agency_payment_method.deleted',
    'agency_contact.created',
    'agency_contact.updated',
    'agency_contact.deleted',
    'review.created',
    'review.moderated'
  ];
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_current
  FROM pg_constraint
  WHERE conrelid = 'public.audit_log'::regclass
    AND conname = 'audit_log_action_check';

  IF v_current IS NOT NULL THEN
    FOR v_lit IN
      SELECT x[1]
      FROM regexp_matches(v_current, $re$'([^']+)'$re$, 'g') AS r(x)
    LOOP
      IF NOT (v_lit = ANY(v_known)) THEN
        RAISE EXCEPTION 'ERR_106_ACTION_GUARD: audit_log_action_check contiene la accion "%" que 106 no conoce. Una migracion posterior agrego valores; mergear manualmente antes de aplicar 106.', v_lit;
      END IF;
    END LOOP;
  END IF;
END
$$;

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_action_check CHECK (
    action IN (
      'trip.created',
      'trip.updated',
      'trip.cancelled',
      'reservation.created',
      'reservation.cancelled',
      'boarding.board',
      'boarding.unboard',
      'agency_settings.updated',
      'notification_preferences.updated',
      'reservation_link.created',
      'reservation_link.cancelled',
      'reservation_link.confirmed',
      'reservation_link.regenerated',
      'reservation_link.passenger_data_saved',
      'reservation_link.expired',
      'reservation.passenger_cancelled',
      'payment.verified',
      'payment.rejected',
      'payment.submitted',
      'checkout.verified',
      'checkout.rejected',
      'checkout.expired',
      'checkout.cancelled',
      'agency_payment_method.created',
      'agency_payment_method.updated',
      'agency_payment_method.primary_set',
      'agency_payment_method.deleted',
      'agency_contact.created',
      'agency_contact.updated',
      'agency_contact.deleted',
      'review.created',
      'review.moderated'
    )
  );

COMMENT ON CONSTRAINT audit_log_action_check ON public.audit_log IS
  'MKT-010.1: 31 acciones de 099 + payment.submitted (envio de comprobante de saldo). Guard antes de sustituir.';

-- ============================================================
-- 3) set_trip_payment_plan (NUEVO)
--    La agencia habilita/deshabilita el pago en dos partes de un
--    viaje propio y exclusivo. Mismo patron de autorizacion que
--    update_agency_trip (105): rol y agencia salen SIEMPRE de
--    public.users; viaje en FOR UPDATE; estado 'active'; UNA sola
--    asignacion en trip_agencies y es la del actor. A difrencia de
--    105 NO hay guarda de cero reservas: el plan se puede
--    configurar (o corregir) con reservas ya registradas; solo
--    afecta a los intentos futuros.
--
--    El trigger trg_trips_audit_fn (065) solo audita
--    route_id/departure_time/capacity/vehicle_type, asi que las
--    columnas del plan NO emiten trip.updated automatico: la
--    auditoria se escribe EXPLICITAMENTE aqui.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_trip_payment_plan(
  p_trip_id UUID,
  p_actor_user_id UUID,
  p_enabled BOOLEAN,
  p_deposit_amount_cents INTEGER,
  p_deposit_deadline TIMESTAMPTZ,
  p_balance_deadline TIMESTAMPTZ
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
  v_enabled BOOLEAN;
  v_before JSONB;
  v_after JSONB;
  v_plan TEXT;
  v_audit_id UUID;
BEGIN
  -- 1) Entrada: actor y bandera obligatorios.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_ACTOR_REQUIRED: actor autenticado requerido';
  END IF;

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_PLAN_INPUT: p_enabled es obligatorio (true/false)';
  END IF;

  v_enabled := p_enabled;

  -- 2) Actor verificado contra public.users: el rol y la agencia
  --    se resuelven en la BD; el cliente no se declara nada.
  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ACTOR_NOT_FOUND: actor no registrado';
  END IF;

  IF v_actor.role <> 'agency' THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN_ROLE: rol % no puede configurar el plan de pagos desde el panel de agencia', v_actor.role;
  END IF;

  IF v_actor.agency_id IS NULL THEN
    RAISE EXCEPTION 'ERR_FORBIDDEN_ROLE: el usuario no tiene una agencia asociada';
  END IF;

  -- 3) Lock de la fila del viaje: serializa con checkout
  --    (create_checkout_attempt lee con FOR UPDATE) y con
  --    ediciones concurrentes.
  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;

  IF v_trip.status <> 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_ACTIVE: Trip is not active';
  END IF;

  -- 4) Exclusividad: exactamente UNA asignacion y es la del actor.
  SELECT COALESCE(array_agg(agency_id ORDER BY agency_id), '{}'::uuid[])
    INTO v_agency_ids
  FROM public.trip_agencies
  WHERE trip_id = p_trip_id;

  IF array_length(v_agency_ids, 1) IS DISTINCT FROM 1
     OR v_agency_ids[1] IS DISTINCT FROM v_actor.agency_id THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_EXCLUSIVE: El viaje no pertenece en exclusiva a esta agencia';
  END IF;

  -- 5) Validaciones del plan (solo al habilitar). El deshabilitar
  --    siempre es valido: limpia importe y vencimientos.
  IF v_enabled THEN
    IF p_deposit_amount_cents IS NULL OR p_deposit_amount_cents <= 0 THEN
      RAISE EXCEPTION 'ERR_PAYMENT_PLAN_DEPOSIT: El deposito debe ser un importe mayor a cero (centavos)';
    END IF;

    IF v_trip.seat_price IS NULL OR v_trip.seat_price <= 0 THEN
      RAISE EXCEPTION 'ERR_PAYMENT_PLAN_PRICE: El viaje necesita precio por asiento para habilitar pagos en dos partes';
    END IF;

    -- Regla 078 complementaria: el deposito SIEMPRE es menor que
    -- el precio por asiento (el saldo debe ser estrictamente > 0).
    IF p_deposit_amount_cents >= v_trip.seat_price THEN
      RAISE EXCEPTION 'ERR_PAYMENT_PLAN_DEPOSIT: El deposito por pasajero debe ser menor que el precio por asiento';
    END IF;

    IF p_deposit_deadline IS NULL OR p_balance_deadline IS NULL THEN
      RAISE EXCEPTION 'ERR_PAYMENT_PLAN_DEADLINES: Ambos vencimientos son obligatorios (deposito y saldo)';
    END IF;

    IF p_deposit_deadline > p_balance_deadline THEN
      RAISE EXCEPTION 'ERR_PAYMENT_PLAN_DEADLINES: El vencimiento del deposito no puede ser posterior al vencimiento del saldo';
    END IF;

    IF p_deposit_deadline <= NOW() THEN
      RAISE EXCEPTION 'ERR_PAYMENT_PLAN_DEADLINES: El vencimiento del deposito debe estar en el futuro';
    END IF;

    -- El saldo se cobra hasta el dia antes o el dia de la salida.
    IF p_balance_deadline > v_trip.departure_time + INTERVAL '1 day' THEN
      RAISE EXCEPTION 'ERR_PAYMENT_PLAN_DEADLINES: El vencimiento del saldo no puede ser posterior al dia de la salida';
    END IF;
  END IF;

  v_before := jsonb_build_object(
    'installment_allowed', v_trip.installment_allowed,
    'installment_amount_cents', v_trip.installment_amount_cents,
    'deposit_deadline', v_trip.deposit_deadline,
    'balance_deadline', v_trip.balance_deadline
  );

  -- 6) Escritura. reservations no es tocado: el plan solo cambia
  --    la configuracion de FUTUROS intentos (los intentos ya
  --    creados conservan su deposito congelado en deposit_cents).
  IF v_enabled THEN
    UPDATE public.trips t
    SET installment_allowed = TRUE,
        installment_amount_cents = p_deposit_amount_cents,
        deposit_deadline = p_deposit_deadline,
        balance_deadline = p_balance_deadline,
        updated_by = p_actor_user_id
    WHERE t.id = p_trip_id;

    v_plan := 'two_stage';
    v_after := jsonb_build_object(
      'installment_allowed', TRUE,
      'installment_amount_cents', p_deposit_amount_cents,
      'deposit_deadline', p_deposit_deadline,
      'balance_deadline', p_balance_deadline
    );
  ELSE
    UPDATE public.trips t
    SET installment_allowed = FALSE,
        installment_amount_cents = NULL,
        deposit_deadline = NULL,
        balance_deadline = NULL,
        updated_by = p_actor_user_id
    WHERE t.id = p_trip_id;

    v_plan := 'single';
    v_after := jsonb_build_object(
      'installment_allowed', FALSE,
      'installment_amount_cents', NULL,
      'deposit_deadline', NULL,
      'balance_deadline', NULL
    );
  END IF;

  -- 7) Auditoria explicita (el trigger de 065 no cubre estas
  --    columnas). Actor agency real, accion 'trip.updated' y
  --    entidad 'trip' ya permitidas por el CHECK vigente.
  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    v_actor.agency_id,
    'trip.updated',
    'trip',
    p_trip_id,
    v_before,
    v_after,
    jsonb_build_object(
      'source', 'api',
      'trigger', 'set_trip_payment_plan',
      'field', 'payment_plan'
    )
  );

  RETURN jsonb_build_object(
    'trip_id', p_trip_id,
    'payment_plan', v_plan,
    'deposit_amount_cents', CASE WHEN v_enabled THEN p_deposit_amount_cents ELSE NULL END,
    'deposit_deadline', CASE WHEN v_enabled THEN p_deposit_deadline ELSE NULL END,
    'balance_deadline', CASE WHEN v_enabled THEN p_balance_deadline ELSE NULL END,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.set_trip_payment_plan(UUID, UUID, BOOLEAN, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'MKT-010.1: habilita/deshabilita el pago en dos partes de un viaje propio y exclusivo de la agencia (deposito fijo por pasajero < seat_price + vencimientos coherentes). Actor y agencia salen de public.users; viaje FOR UPDATE, status active y asignacion exclusiva (mismo patron que 105). No exige cero reservas: solo afecta intentos futuros. Deshabilitar limpia importe y vencimientos. Auditoria trip.updated explicita. EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.set_trip_payment_plan(UUID, UUID, BOOLEAN, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_trip_payment_plan(UUID, UUID, BOOLEAN, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.set_trip_payment_plan(UUID, UUID, BOOLEAN, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_trip_payment_plan(UUID, UUID, BOOLEAN, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- ============================================================
-- 4) create_checkout_attempt (REEMPLAZA a la de 096)
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
  v_installment_allowed BOOLEAN;
  v_installment_amount INTEGER;
  v_payment_plan TEXT := 'single';
  v_deposit_cents INTEGER;
  v_total_amount INTEGER;
  v_deposit_deadline TIMESTAMPTZ;
  v_balance_deadline TIMESTAMPTZ;
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
  SELECT t.status, t.departure_time, t.seat_price, t.is_published,
         t.installment_allowed, t.installment_amount_cents,
         t.deposit_deadline, t.balance_deadline
    INTO v_trip_status, v_departure, v_unit_price, v_trip_is_published,
         v_installment_allowed, v_installment_amount,
         v_deposit_deadline, v_balance_deadline
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
      -- MKT-010.1: los campos del plan salen del intento
      -- existente; los vencimientos se leen EN VIVO de la viaja.
      v_payment_plan := v_existing.payment_plan;
      v_deposit_cents := v_existing.deposit_cents;
      v_total_amount := v_existing.unit_price * cardinality(v_existing.seat_ids);

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
        'payment_plan', v_payment_plan,
        'deposit_cents', v_deposit_cents,
        'total_cents', v_total_amount,
        'balance_cents', v_total_amount - COALESCE(v_deposit_cents, v_total_amount),
        'deposit_pct', CASE WHEN v_payment_plan = 'two_stage'
                            THEN ROUND((v_deposit_cents * 100.0) / v_total_amount)::INTEGER
                            ELSE NULL END,
        'balance_pct', CASE WHEN v_payment_plan = 'two_stage'
                            THEN 100 - ROUND((v_deposit_cents * 100.0) / v_total_amount)::INTEGER
                            ELSE NULL END,
        'deposit_deadline', CASE WHEN v_payment_plan = 'two_stage' THEN v_deposit_deadline ELSE NULL END,
        'balance_deadline', CASE WHEN v_payment_plan = 'two_stage' THEN v_balance_deadline ELSE NULL END,
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

    -- MKT-010.1: campos del plan desde el intento existente.
    v_payment_plan := v_existing.payment_plan;
    v_deposit_cents := v_existing.deposit_cents;
    v_total_amount := v_existing.unit_price * cardinality(v_existing.seat_ids);

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
      'payment_plan', v_payment_plan,
      'deposit_cents', v_deposit_cents,
      'total_cents', v_total_amount,
      'balance_cents', v_total_amount - COALESCE(v_deposit_cents, v_total_amount),
      'deposit_pct', CASE WHEN v_payment_plan = 'two_stage'
                          THEN ROUND((v_deposit_cents * 100.0) / v_total_amount)::INTEGER
                          ELSE NULL END,
      'balance_pct', CASE WHEN v_payment_plan = 'two_stage'
                          THEN 100 - ROUND((v_deposit_cents * 100.0) / v_total_amount)::INTEGER
                          ELSE NULL END,
      'deposit_deadline', CASE WHEN v_payment_plan = 'two_stage' THEN v_deposit_deadline ELSE NULL END,
      'balance_deadline', CASE WHEN v_payment_plan = 'two_stage' THEN v_balance_deadline ELSE NULL END,
      'proof_count', v_existing.proof_count,
      'expires_at', v_existing.expires_at,
      'idempotent', true
    );
  END IF;

  -- 6) Snapshot comercial: precio unitario y total congelados aqui.
  --    MKT-010.1: el PLAN se calcula SERVER-SIDE desde la fila del
  --    viaje (ya bloqueada con FOR UPDATE arriba). La configuracion
  --    invalida de la agencia (importe ausente, no positivo, >=
  --    precio por asiento o vencimientos ausentes) cae a 'single'
  --    en lugar de romper el checkout: se corrige desde
  --    set_trip_payment_plan. Exigir AMBOS vencimientos aqui
  --    garantiza que todo intento two_stage nazca con importe y
  --    plazos completos (los datos legados de 078, anteriores a
  --    estas columnas, no pueden formar un plan incompleto).
  v_total_amount := v_unit_price * v_count;
  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'ERR_TRIP_PRICE_MISSING: Computed amount must be positive';
  END IF;

  IF v_installment_allowed IS TRUE
     AND v_installment_amount IS NOT NULL
     AND v_installment_amount > 0
     AND v_installment_amount < v_unit_price
     AND v_deposit_deadline IS NOT NULL
     AND v_balance_deadline IS NOT NULL THEN
    v_payment_plan := 'two_stage';
    v_deposit_cents := v_installment_amount * v_count;
  ELSE
    v_payment_plan := 'single';
    v_deposit_cents := NULL;
  END IF;

  -- En two_stage el importe del intento es el DEPOSITO (lo que el
  -- cliente paga en la etapa 1); en single sigue siendo el total
  -- (legado, sin ningun cambio de comportamiento).
  v_amount := CASE WHEN v_payment_plan = 'two_stage'
                   THEN v_deposit_cents
                   ELSE v_total_amount END;

  INSERT INTO public.checkout_attempts (
    trip_id, agency_id, customer_id, seat_ids, passenger_data,
    unit_price, amount_cents, status, idempotency_key, expires_at,
    payment_plan, deposit_cents
  ) VALUES (
    p_trip_id, p_agency_id, p_customer_id, p_seat_ids, p_passenger_data,
    v_unit_price, v_amount, 'created', v_key_ns, v_expires_at,
    v_payment_plan, v_deposit_cents
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
    'payment_plan', v_payment_plan,
    'deposit_cents', v_deposit_cents,
    'total_cents', v_total_amount,
    'balance_cents', v_total_amount - COALESCE(v_deposit_cents, v_total_amount),
    'deposit_pct', CASE WHEN v_payment_plan = 'two_stage'
                        THEN ROUND((v_deposit_cents * 100.0) / v_total_amount)::INTEGER
                        ELSE NULL END,
    'balance_pct', CASE WHEN v_payment_plan = 'two_stage'
                        THEN 100 - ROUND((v_deposit_cents * 100.0) / v_total_amount)::INTEGER
                        ELSE NULL END,
    'deposit_deadline', CASE WHEN v_payment_plan = 'two_stage' THEN v_deposit_deadline ELSE NULL END,
    'balance_deadline', CASE WHEN v_payment_plan = 'two_stage' THEN v_balance_deadline ELSE NULL END,
    'proof_count', 0,
    'expires_at', v_expires_at,
    'idempotent', false
  );
END;
$$;

COMMENT ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) IS
  'MKT-007 + TRIP-PUB-001.2 + MKT-010.1: crea UN checkout_attempt (status=created) y estampa seats.checkout_attempt_id en la misma transaccion. NO crea reservations ni payments. Verifica trip activo, PUBLICADO en el Marketplace (is_published, 095, leido con FOR UPDATE sobre la fila del viaje: una despublicacion concurrente se serializa y no puede habilitar un checkout nuevo), no partido, con precio, agencia ofertada, y ownership de los seats (locked_by=customer, guest_session_id NULL, TTL vigente) con FOR UPDATE; rechaza asientos ya reclamados por OTRO intento. Congela el snapshot de pasajeros (seat_id, first_name, last_name, document, phone) en el MISMO orden que seat_ids. La ventana inicial hereda el TTL restante (900 s) para que el cliente no se prolongue su propia expiracion. Idempotente por set de asientos y por Idempotency-Key. MKT-010.1: calcula el plan server-side desde la fila del viaje (installment_* + vencimientos, con FOR UPDATE); en two_stage amount_cents es el DEPOSITO total (deposit_cents) y el resultado agrega payment_plan, deposit_cents, total_cents, balance_cents, deposit_pct, balance_pct y los dos vencimientos. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_attempt(UUID, UUID, UUID, UUID[], JSONB, UUID) TO service_role;

-- ============================================================
-- 5) verify_checkout_attempt (REEMPLAZA a la de 087)
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_checkout_attempt(
  p_attempt_id UUID,
  p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_actor public.users%ROWTYPE;
  v_destination TEXT;
  v_trip_status TEXT;
  v_seat RECORD;
  v_found_seats INTEGER := 0;
  v_pax_count INTEGER := 0;
  v_expected_amount INTEGER;
  v_reservation_id UUID;
  v_payment_id UUID;
  v_payment_submitted_at TIMESTAMPTZ;
  v_ticket_code CHAR(8);
  v_qr_code TEXT;
  v_rowcount BIGINT;
  v_i INTEGER;
  v_elem JSONB;
  v_seat_id UUID;
  v_first_name TEXT;
  v_last_name TEXT;
  v_document TEXT;
  v_phone TEXT;
  v_seen_docs TEXT[] := ARRAY[]::TEXT[];
  v_payment_key TEXT;
  v_existing_payment public.payments%ROWTYPE;
  v_constraint TEXT;
  v_audit_id UUID;
  v_reservation_audit_id UUID;
  v_payment_plan TEXT;
  v_deposit_cents INTEGER;
  v_total_amount INTEGER;
  v_payment_status TEXT;
  v_deposit_deadline TIMESTAMPTZ;
  v_balance_deadline TIMESTAMPTZ;
BEGIN
  -- 1) Intento con lock de fila: hoja del orden de locks.
  SELECT ca.*
    INTO v_attempt
  FROM public.checkout_attempts ca
  WHERE ca.id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ATTEMPT_NOT_FOUND: Checkout attempt not found';
  END IF;

  -- 2) Autorizacion: actor agency con ownership. agency_id NUNCA
  --    llega del cliente; se resuelve del registro public.users.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ADMIN_NOT_FOUND: Actor not found';
  END IF;

  SELECT u.* INTO v_actor
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ADMIN_NOT_FOUND: Actor not found';
  END IF;

  IF v_actor.role IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ADMIN_ROLE: Only agency users can review checkouts';
  END IF;

  IF v_actor.agency_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ADMIN_AGENCY: Agency user has no agency_id';
  END IF;

  IF v_attempt.agency_id IS DISTINCT FROM v_actor.agency_id THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_AGENCY_MISMATCH: Checkout attempt does not belong to this agency';
  END IF;

  -- 3) Idempotencia por estado: reintentar la aprobacion devuelve el
  --    resultado existente sin duplicar nada.
  IF v_attempt.status = 'verified' THEN
    SELECT p.id, p.reservation_id
      INTO v_payment_id, v_reservation_id
    FROM public.payments p
    WHERE p.idempotency_key = 'mkt007:' || v_attempt.id::text || ':verify';

    -- MKT-010.1: campos del plan desde el intento; vencimientos
    -- leidos EN VIVO de la viaja.
    v_payment_plan := COALESCE(v_attempt.payment_plan, 'single');
    v_deposit_cents := v_attempt.deposit_cents;
    v_total_amount := v_attempt.unit_price * cardinality(v_attempt.seat_ids);

    SELECT t.deposit_deadline, t.balance_deadline
      INTO v_deposit_deadline, v_balance_deadline
    FROM public.trips t
    WHERE t.id = v_attempt.trip_id;

    RETURN jsonb_build_object(
      'attempt_id', v_attempt.id,
      'status', 'verified',
      'already_verified', true,
      'reservation_id', v_reservation_id,
      'payment_id', v_payment_id,
      'amount_cents', v_attempt.amount_cents,
      'payment_plan', v_payment_plan,
      'deposit_cents', v_deposit_cents,
      'total_cents', v_total_amount,
      'balance_cents', v_total_amount - COALESCE(v_deposit_cents, v_total_amount),
      'deposit_pct', CASE WHEN v_payment_plan = 'two_stage'
                          THEN ROUND((v_deposit_cents * 100.0) / v_total_amount)::INTEGER
                          ELSE NULL END,
      'balance_pct', CASE WHEN v_payment_plan = 'two_stage'
                          THEN 100 - ROUND((v_deposit_cents * 100.0) / v_total_amount)::INTEGER
                          ELSE NULL END,
      'deposit_deadline', CASE WHEN v_payment_plan = 'two_stage' THEN v_deposit_deadline ELSE NULL END,
      'balance_deadline', CASE WHEN v_payment_plan = 'two_stage' THEN v_balance_deadline ELSE NULL END,
      'proof_count', v_attempt.proof_count,
      'verified_at', v_attempt.verified_at,
      'verified_by', v_attempt.verified_by
    );
  END IF;

  IF v_attempt.status IS DISTINCT FROM 'pending_review' THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_NOT_PENDING: Checkout attempt is in status %', v_attempt.status;
  END IF;

  IF v_attempt.expires_at <= NOW() THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_WINDOW_EXPIRED: The review window has expired';
  END IF;

  IF v_attempt.proof_count IS NULL OR v_attempt.proof_count < 1 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_NO_PROOF: The checkout attempt has no submitted proof';
  END IF;

  -- 4) Viaje sigue activo. Los vencimientos del plan se leen aqui
  --    (EN VIVO, nunca un snapshot) para devolverlos.
  SELECT t.status, r.destination, t.deposit_deadline, t.balance_deadline
    INTO v_trip_status, v_destination, v_deposit_deadline, v_balance_deadline
  FROM public.trips t
  LEFT JOIN public.routes r ON r.id = t.route_id
  WHERE t.id = v_attempt.trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_FOUND: Trip not found';
  END IF;
  IF v_trip_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ERR_TRIP_NOT_ACTIVE: Trip is not active';
  END IF;

  -- 5) Seats: aun locked, aun vinculados a ESTE intento. Aqui se
  --    exige el bloqueo definitivo: cualquier fila que no cumpla
  --    aborta la transaccion completa antes de escribir nada.
  FOR v_seat IN
    SELECT s.id, s.seat_code, s.trip_id, s.status, s.locked_by,
           s.guest_session_id, s.checkout_attempt_id
    FROM public.seats s
    WHERE s.id = ANY(v_attempt.seat_ids)
    ORDER BY s.id
    FOR UPDATE
  LOOP
    v_found_seats := v_found_seats + 1;

    IF v_seat.trip_id IS DISTINCT FROM v_attempt.trip_id
       OR v_seat.status IS DISTINCT FROM 'locked'
       OR v_seat.checkout_attempt_id IS DISTINCT FROM v_attempt.id
       OR v_seat.locked_by IS DISTINCT FROM v_attempt.customer_id
       OR v_seat.guest_session_id IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_CHECKOUT_SEAT_STATE: Seat % is no longer held by this checkout attempt', v_seat.seat_code;
    END IF;
  END LOOP;

  IF v_found_seats <> cardinality(v_attempt.seat_ids) THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_SEAT_STATE: One or more attempt seats are missing';
  END IF;

  -- 6) Pasajeros 1:1 con los asientos, documentos unicos y monto
  --    consistente con el SNAPSHOT (no se relee trips.seat_price: el
  --    precio congelado en el intento es el que se cobra).
  v_pax_count := jsonb_array_length(v_attempt.passenger_data);

  IF v_pax_count <> cardinality(v_attempt.seat_ids) THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_AMOUNT_INVALID: Passengers do not match seats 1:1';
  END IF;

  IF v_attempt.unit_price IS NULL OR v_attempt.unit_price <= 0 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_AMOUNT_INVALID: Snapshot unit price is missing';
  END IF;

  -- MKT-010.1: en dos partes lo que se aprueba AQUI es el
  -- DEPOSITO (amount_cents = deposito total congelado al crear el
  -- intento); en single sigue siendo el total (legado). La
  -- reserva nace entonces en payment_status='partial' y los
  -- asientos quedan 'reserved' esperando el saldo.
  v_payment_plan := COALESCE(v_attempt.payment_plan, 'single');
  v_total_amount := v_attempt.unit_price * v_pax_count;

  IF v_payment_plan = 'two_stage' THEN
    v_deposit_cents := v_attempt.deposit_cents;

    IF v_deposit_cents IS NULL OR v_deposit_cents <= 0 THEN
      RAISE EXCEPTION 'ERR_CHECKOUT_AMOUNT_INVALID: Two-stage attempt has no deposit amount';
    END IF;

    IF v_deposit_cents >= v_total_amount THEN
      RAISE EXCEPTION 'ERR_CHECKOUT_AMOUNT_INVALID: Deposit must be smaller than the full total';
    END IF;

    IF v_deposit_cents % v_pax_count <> 0 THEN
      RAISE EXCEPTION 'ERR_CHECKOUT_AMOUNT_INVALID: Deposit does not divide evenly across passengers';
    END IF;

    v_expected_amount := v_deposit_cents;
    v_payment_status := 'partial';
  ELSE
    v_deposit_cents := NULL;
    v_expected_amount := v_total_amount;
    v_payment_status := 'fully_paid';
  END IF;

  IF v_expected_amount <> v_attempt.amount_cents OR v_expected_amount <= 0 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_AMOUNT_INVALID: Snapshot amount is inconsistent with unit price';
  END IF;

  FOR v_i IN 0 .. v_pax_count - 1 LOOP
    v_elem := v_attempt.passenger_data->v_i;
    v_seat_id := (v_elem->>'seat_id')::uuid;
    v_first_name := btrim(COALESCE(v_elem->>'first_name', ''));
    v_last_name := btrim(COALESCE(v_elem->>'last_name', ''));
    v_document := btrim(COALESCE(v_elem->>'document', ''));
    v_phone := NULLIF(btrim(COALESCE(v_elem->>'phone', '')), '');

    IF v_seat_id IS DISTINCT FROM v_attempt.seat_ids[v_i + 1] THEN
      RAISE EXCEPTION 'ERR_CHECKOUT_AMOUNT_INVALID: Passenger order does not match seat order';
    END IF;
    IF length(v_first_name) < 2 OR length(v_last_name) < 2 THEN
      RAISE EXCEPTION 'ERR_CHECKOUT_PASSENGER_DATA: Passenger name is incomplete';
    END IF;
    IF length(v_document) = 0 THEN
      RAISE EXCEPTION 'ERR_CHECKOUT_PASSENGER_DATA: Passenger document is required';
    END IF;
    IF v_document = ANY(v_seen_docs) THEN
      RAISE EXCEPTION 'ERR_CHECKOUT_PASSENGER_DUPLICATE_DOCUMENT: Document % is repeated', v_document;
    END IF;
    v_seen_docs := v_seen_docs || v_document;
  END LOOP;

  -- 7) Backstop de duplicado: el namespace es UNIQUE en payments.
  v_payment_key := 'mkt007:' || v_attempt.id::text || ':verify';

  SELECT p.* INTO v_existing_payment
  FROM public.payments p
  WHERE p.idempotency_key = v_payment_key;

  IF FOUND THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ALREADY_VERIFIED: A payment already exists for this checkout attempt';
  END IF;

  -- 8) Reserva definitiva. status='reserved' es el estado definitivo
  --    del ciclo marketplace (075) y es el unico que hace emitir a
  --    082 el evento reservation.created en un INSERT.
  v_reservation_id := gen_random_uuid();
  v_ticket_code := UPPER(LEFT(REPLACE(v_reservation_id::text, '-', ''), 8));
  v_qr_code := 'NT-' || UPPER(COALESCE(v_destination, '')) || '-' || UPPER(REPLACE(v_reservation_id::text, '-', ''));

  INSERT INTO public.reservations (
    id, trip_id, agency_id, created_by, customer_id, source, status,
    booker_name, booker_document, booker_phone,
    qr_code, ticket_code, payment_status
  ) VALUES (
    v_reservation_id,
    v_attempt.trip_id,
    v_attempt.agency_id,
    v_attempt.customer_id,
    v_attempt.customer_id,
    'marketplace',
    'reserved',
    btrim(v_attempt.passenger_data->0->>'first_name') || ' ' || btrim(v_attempt.passenger_data->0->>'last_name'),
    btrim(v_attempt.passenger_data->0->>'document'),
    NULLIF(btrim(COALESCE(v_attempt.passenger_data->0->>'phone', '')), ''),
    v_qr_code,
    v_ticket_code,
    v_payment_status
  );

  -- 9) Pasajeros definitivos con el snapshot del intento.
  FOR v_i IN 0 .. v_pax_count - 1 LOOP
    v_elem := v_attempt.passenger_data->v_i;

    INSERT INTO public.reservation_passengers (
      reservation_id, seat_id, name, document, phone, unit_price, status
    ) VALUES (
      v_reservation_id,
      (v_elem->>'seat_id')::uuid,
      btrim(v_elem->>'first_name') || ' ' || btrim(v_elem->>'last_name'),
      btrim(v_elem->>'document'),
      NULLIF(btrim(COALESCE(v_elem->>'phone', '')), ''),
      v_attempt.unit_price,
      'active'
    );
  END LOOP;

  -- 10) Pago VERIFICADO con los datos de conciliacion transferidos.
  --     Nunca existio un pago 'pending' para este intento.
  v_payment_submitted_at := COALESCE(v_attempt.proof_submitted_at, NOW());

  BEGIN
    INSERT INTO public.payments (
      reservation_id, agency_id, customer_id, provider,
      external_reference, bank_origin, payment_datetime,
      amount_cents, currency, status, proof_url, stage,
      idempotency_key, submitted_at, verified_at, verified_by
    ) VALUES (
      v_reservation_id,
      v_attempt.agency_id,
      v_attempt.customer_id,
      'manual',
      v_attempt.payment_reference,
      v_attempt.bank_origin,
      v_attempt.payment_datetime,
      v_attempt.amount_cents,
      'COP',
      'verified',
      v_attempt.proof_path,
      CASE WHEN v_payment_plan = 'two_stage' THEN 'deposit' ELSE 'full' END,
      v_payment_key,
      v_payment_submitted_at,
      NOW(),
      p_actor_user_id
    )
    RETURNING id INTO v_payment_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint IS DISTINCT FROM 'payments_idempotency_key' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION 'ERR_CHECKOUT_ALREADY_VERIFIED: A payment already exists for this checkout attempt';
  END;

  -- 11) Una allocation por pasajero activo. MKT-010.1: en dos
  --     partes cada allocation es el DEPOSITO por pasajero
  --     (deposit_cents / pax, division exacta validada arriba);
  --     en single sigue siendo el unit_price exacto (legado).
  INSERT INTO public.payment_allocations (
    payment_id, reservation_id, reservation_passenger_id, amount_cents
  )
  SELECT v_payment_id, v_reservation_id, rp.id,
         CASE WHEN v_payment_plan = 'two_stage'
              THEN v_deposit_cents / v_pax_count
              ELSE rp.unit_price
         END
  FROM public.reservation_passengers rp
  WHERE rp.reservation_id = v_reservation_id
    AND rp.status = 'active';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  IF v_rowcount <> v_pax_count THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_AMOUNT_INVALID: Allocation count does not match passenger count';
  END IF;

  -- 12) Transicion definitiva de los asientos. El trigger de 080
  --     limpia lock metadata y el de 087 deja checkout_attempt_id en
  --     NULL; aqui lo fijamos explicitamente por claridad.
  UPDATE public.seats s
  SET status = 'reserved',
      locked_by = NULL,
      locked_at = NULL,
      lock_expires_at = NULL,
      guest_session_id = NULL,
      checkout_attempt_id = NULL
  WHERE s.id = ANY(v_attempt.seat_ids)
    AND s.status = 'locked';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  IF v_rowcount <> cardinality(v_attempt.seat_ids) THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_SEAT_STATE: Seat state changed during approval';
  END IF;

  -- 13) Cierre del intento.
  UPDATE public.checkout_attempts ca
  SET status = 'verified',
      verified_at = NOW(),
      verified_by = p_actor_user_id,
      closed_at = NOW(),
      rejection_reason = NULL
  WHERE ca.id = p_attempt_id
    AND ca.status = 'pending_review';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_RACE: Checkout attempt changed during approval';
  END IF;

  -- 14) Auditoria: actor 'agency' (permitido por audit_append).
  --     reservation.created con entity 'reservation' ya esta en los
  --     CHECK desde 065.
  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    v_attempt.agency_id,
    'checkout.verified',
    'checkout_attempt',
    p_attempt_id,
    jsonb_build_object('status', 'pending_review', 'proof_count', v_attempt.proof_count),
    jsonb_build_object(
      'status', 'verified',
      'reservation_id', v_reservation_id,
      'payment_id', v_payment_id,
      'amount_cents', v_attempt.amount_cents
    ),
    jsonb_build_object(
      'proof_count', v_attempt.proof_count,
      'payment_reference', v_attempt.payment_reference,
      'bank_origin', v_attempt.bank_origin,
      'payment_datetime', v_attempt.payment_datetime,
      'trigger', 'mkt007_verify'
    )
  );

  v_reservation_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    v_attempt.agency_id,
    'reservation.created',
    'reservation',
    v_reservation_id,
    NULL,
    jsonb_build_object('status', 'reserved', 'source', 'marketplace'),
    jsonb_build_object('checkout_attempt_id', p_attempt_id, 'trigger', 'mkt007_verify')
  );

  RETURN jsonb_build_object(
    'attempt_id', p_attempt_id,
    'status', 'verified',
    'already_verified', false,
    'reservation_id', v_reservation_id,
    'payment_id', v_payment_id,
    'amount_cents', v_attempt.amount_cents,
    'currency', 'COP',
    'payment_plan', v_payment_plan,
    'deposit_cents', v_deposit_cents,
    'total_cents', v_total_amount,
    'balance_cents', v_total_amount - COALESCE(v_deposit_cents, v_total_amount),
    'deposit_pct', CASE WHEN v_payment_plan = 'two_stage'
                        THEN ROUND((v_deposit_cents * 100.0) / v_total_amount)::INTEGER
                        ELSE NULL END,
    'balance_pct', CASE WHEN v_payment_plan = 'two_stage'
                        THEN 100 - ROUND((v_deposit_cents * 100.0) / v_total_amount)::INTEGER
                        ELSE NULL END,
    'deposit_deadline', CASE WHEN v_payment_plan = 'two_stage' THEN v_deposit_deadline ELSE NULL END,
    'balance_deadline', CASE WHEN v_payment_plan = 'two_stage' THEN v_balance_deadline ELSE NULL END,
    'proof_count', v_attempt.proof_count,
    'allocation_count', v_pax_count,
    'passenger_count', v_pax_count,
    'verified_at', NOW(),
    'verified_by', p_actor_user_id,
    'payment_status', v_payment_status,
    'audit_id', v_audit_id,
    'reservation_audit_id', v_reservation_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.verify_checkout_attempt(UUID, UUID) IS
  'MKT-007 + MKT-010.1: aprobacion ATOMICA de un checkout_attempt. En UNA transaccion valida estado pending_review + ventana vigente + actor agency con ownership, bloquea los seats del intento, comprueba pasajeros 1:1 y monto contra el snapshot, y crea reservations (status=reserved, source=marketplace, payment_status=fully_paid) + reservation_passengers + payments (status=verified con external_reference/bank_origin/payment_datetime) + payment_allocations, transiciona los seats a reserved, cierra el intento y escribe la auditoria. 082 emite reservation.created en el INSERT. Idempotente sobre status=verified. MKT-010.1: con payment_plan=two_stage aprueba el DEPOSITO (payments.stage=''deposit'', allocations = deposito por pasajero, reservation.payment_status=''partial''); con single aprueba el total (stage=''full'', ''fully_paid'') exactamente como 087. Los asientos pasan a ''reserved'' en ambos casos y jamas se liberan por saldo pendiente. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.verify_checkout_attempt(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_checkout_attempt(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.verify_checkout_attempt(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_checkout_attempt(UUID, UUID) TO service_role;

-- ============================================================
-- 6) verify_marketplace_payment (REEMPLAZA a la de 085)
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_marketplace_payment(
  p_payment_id UUID,
  p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_reservation public.reservations%ROWTYPE;
  v_actor public.users%ROWTYPE;
  v_pax RECORD;
  v_seat RECORD;
  v_seat_ids UUID[] := ARRAY[]::UUID[];
  v_seat_codes TEXT[] := ARRAY[]::TEXT[];
  v_active_count INTEGER := 0;
  v_priced_count INTEGER := 0;
  v_distinct_seats INTEGER := 0;
  v_total_expected INTEGER := 0;
  v_found_seats INTEGER := 0;
  v_existing_alloc_count INTEGER := 0;
  v_alloc_count INTEGER := 0;
  v_rowcount BIGINT;
  v_audit_id UUID;
  v_stage TEXT;
  v_already_allocated INTEGER := 0;
  v_balance_expected INTEGER := 0;
  v_new_alloc_total INTEGER := 0;
BEGIN
  -- ── 1) Entrada ─────────────────────────────────────────────
  IF p_payment_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_INPUT: p_payment_id and p_actor_user_id are required';
  END IF;

  -- ── 2) Bloquear el pago (hoja deadlock-safe, ver cabecera) ─
  SELECT p.*
    INTO v_payment
  FROM public.payments p
  WHERE p.id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_NOT_FOUND: Payment not found';
  END IF;

  -- ── 2b) Etapa del pago (MKT-010.1) ─────────────────────────
  --       'balance' se verifica contra el saldo restante;
  --       'full' conserva la regla legada. Un deposito jamas
  --       llega pendiente aqui: se aprueba con el intento de
  --       compra (verify_checkout_attempt), no desde este panel.
  v_stage := COALESCE(v_payment.stage, 'full');

  IF v_stage = 'deposit' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_STAGE_DEPOSIT: Deposit payments are verified with the checkout attempt, not from here';
  END IF;

  -- ── 3) Bloquear la reserva (orden 046: payments -> reservations) ─
  SELECT r.*
    INTO v_reservation
  FROM public.reservations r
  WHERE r.id = v_payment.reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_RESERVATION_NOT_FOUND: Reservation not found';
  END IF;

  -- ── 4) Alcance marketplace ─────────────────────────────────
  IF v_reservation.source IS DISTINCT FROM 'marketplace' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_NOT_MARKETPLACE: Payment does not belong to a marketplace reservation';
  END IF;

  -- ── 5) Autorizacion: actor agency con ownership (Fase 6.2B) ─
  --       El agency_id NUNCA llega del cliente: se resuelve del
  --       registro public.users del actor autenticado. ─────────
  SELECT u.*
    INTO v_actor
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_ADMIN_NOT_FOUND: Actor not found';
  END IF;

  IF v_actor.role IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_ADMIN_ROLE: Only agency users can verify payments';
  END IF;

  IF v_actor.agency_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_ADMIN_AGENCY: Agency user has no agency_id';
  END IF;

  -- Coherencia payments <-> reservations (defensa contra datos corruptos)
  IF v_payment.agency_id IS DISTINCT FROM v_reservation.agency_id THEN
    RAISE EXCEPTION 'ERR_PAYMENT_AGENCY_MISMATCH: Payment and reservation agency mismatch';
  END IF;

  -- Ownership: el pago y la reserva deben pertenecer a la agencia del actor
  IF v_payment.agency_id IS DISTINCT FROM v_actor.agency_id THEN
    RAISE EXCEPTION 'ERR_PAYMENT_AGENCY_MISMATCH: Payment does not belong to this agency';
  END IF;

  -- ── 6) Idempotencia: reintento vs contradiccion ────────────
  IF v_payment.status = 'verified' THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment.id,
      'reservation_id', v_payment.reservation_id,
      'status', 'verified',
      'already_verified', true,
      'stage', v_stage,
      'amount_cents', v_payment.amount_cents,
      'currency', v_payment.currency,
      'verified_at', v_payment.verified_at,
      'verified_by', v_payment.verified_by,
      'allocation_count', 0
    );
  END IF;

  IF v_payment.status = 'rejected' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_ALREADY_REJECTED: A rejected payment cannot be verified';
  END IF;

  IF v_payment.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_NOT_PENDING: Payment is in status %', v_payment.status;
  END IF;

  -- ── 7) La reserva debe estar 'reserved' (compatible con verificacion) ─
  IF v_reservation.status IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_RESERVATION_STATE: Reservation is in status %, expected reserved', v_reservation.status;
  END IF;

  -- ── 8) Pasajeros activos con FOR UPDATE (orden por seat_id).
  --       Estabiliza el conjunto contra 079 concurrente. ──────
  FOR v_pax IN
    SELECT rp.id, rp.seat_id, rp.unit_price
    FROM public.reservation_passengers rp
    WHERE rp.reservation_id = v_payment.reservation_id
      AND rp.status = 'active'
    ORDER BY rp.seat_id
    FOR UPDATE
  LOOP
    v_active_count := v_active_count + 1;
    v_seat_ids := v_seat_ids || v_pax.seat_id;

    IF v_pax.unit_price IS NOT NULL AND v_pax.unit_price > 0 THEN
      v_priced_count := v_priced_count + 1;
      v_total_expected := v_total_expected + v_pax.unit_price;
    END IF;
  END LOOP;

  IF v_active_count = 0 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_NO_PASSENGERS: Reservation has no active passengers to verify';
  END IF;

  IF v_priced_count <> v_active_count THEN
    RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_PRICE: All active passengers must have a positive unit_price';
  END IF;

  SELECT COUNT(DISTINCT u)
    INTO v_distinct_seats
  FROM unnest(v_seat_ids) u;

  IF v_distinct_seats <> v_active_count THEN
    RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_SEATS: Reservation seats do not match active passengers 1:1';
  END IF;

  -- ── 9) El importe debe coincidir EXACTAMENTE ───────────────
  --       MKT-010.1: stage='balance' se cobra contra el SALDO
  --       exacto restante (total - allocations verificadas): ni
  --       de mas (el sobrepago se rechaza) ni de menos. stage=
  --       'full' conserva la regla legada: importe = total. ──
  IF v_stage = 'balance' THEN
    SELECT COALESCE(SUM(pa.amount_cents), 0)
      INTO v_already_allocated
    FROM public.payment_allocations pa
    JOIN public.payments p
      ON p.id = pa.payment_id
     AND p.status = 'verified'
    WHERE pa.reservation_id = v_payment.reservation_id;

    v_balance_expected := v_total_expected - v_already_allocated;

    IF v_balance_expected <= 0 THEN
      RAISE EXCEPTION 'ERR_BALANCE_ALREADY_SETTLED: The reservation balance is already settled';
    END IF;

    IF v_payment.amount_cents <> v_balance_expected THEN
      RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_AMOUNT: Payment amount % does not match the outstanding balance %', v_payment.amount_cents, v_balance_expected;
    END IF;
  ELSIF v_total_expected <> v_payment.amount_cents THEN
    RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_AMOUNT: Payment amount % does not match expected total %', v_payment.amount_cents, v_total_expected;
  END IF;

  -- ── 10) Coherencia de asientos (SELECT plano; verify NO bloquea seats) ─
  FOR v_seat IN
    SELECT s.id, s.seat_code, s.trip_id, s.status
    FROM public.seats s
    WHERE s.id = ANY(v_seat_ids)
    ORDER BY s.id
  LOOP
    v_found_seats := v_found_seats + 1;
    v_seat_codes := v_seat_codes || v_seat.seat_code;

    IF v_seat.trip_id IS DISTINCT FROM v_reservation.trip_id THEN
      RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_SEAT_TRIP: Seat % does not belong to the reservation trip', v_seat.seat_code;
    END IF;

    IF v_seat.status IS DISTINCT FROM 'reserved' THEN
      RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_SEAT_STATE: Seat % is in status %, expected reserved', v_seat.seat_code, v_seat.status;
    END IF;
  END LOOP;

  IF v_found_seats <> v_active_count THEN
    RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_SEAT_MISSING: One or more reservation seats not found';
  END IF;

  -- ── 11) Integridad financiera: un pago pending NO tiene allocations ─
  SELECT COUNT(*)
    INTO v_existing_alloc_count
  FROM public.payment_allocations pa
  WHERE pa.payment_id = p_payment_id;

  IF v_existing_alloc_count <> 0 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_ALLOCATIONS: Pending payment already has allocations';
  END IF;

  -- ── 12) Crear UNA allocation por pasajero activo. ───────────
  --       MKT-010.1: en 'full' cada allocation es el unit_price
  --       exacto (legado). En 'balance' es el RESTO por pasajero
  --       (unit_price - lo ya verificado); los pasajeros ya
  --       cubiertos al 100% se omiten (amount_cents > 0 es
  --       CHECK). Sin ON CONFLICT: ya validamos count=0 y
  --       retenemos el lock del pago, asi que ninguna
  --       verificacion concurrente puede insertar allocations
  --       para este payment_id. Cualquier violacion unique
  --       inesperada propaga y revierte TODO. ──────────────────
  INSERT INTO public.payment_allocations (
    payment_id,
    reservation_id,
    reservation_passenger_id,
    amount_cents
  )
  SELECT
    p_payment_id,
    v_payment.reservation_id,
    rp.id,
    CASE WHEN v_stage = 'balance'
         THEN rp.unit_price - COALESCE(alloc.allocated, 0)
         ELSE rp.unit_price
    END
  FROM public.reservation_passengers rp
  LEFT JOIN (
    SELECT pa.reservation_passenger_id, SUM(pa.amount_cents) AS allocated
    FROM public.payment_allocations pa
    JOIN public.payments p
      ON p.id = pa.payment_id
     AND p.status = 'verified'
    WHERE pa.reservation_id = v_payment.reservation_id
    GROUP BY pa.reservation_passenger_id
  ) alloc ON alloc.reservation_passenger_id = rp.id
  WHERE rp.reservation_id = v_payment.reservation_id
    AND rp.status = 'active'
    AND rp.unit_price IS NOT NULL
    AND rp.unit_price > 0
    AND (v_stage <> 'balance'
         OR rp.unit_price - COALESCE(alloc.allocated, 0) > 0)
  ORDER BY rp.seat_id;

  GET DIAGNOSTICS v_alloc_count = ROW_COUNT;

  IF v_stage = 'balance' THEN
    -- La suma de las allocations nuevas debe cubrir EXACTAMENTE
    -- el saldo restante (ya validado igual al importe del pago).
    SELECT COALESCE(SUM(pa.amount_cents), 0)
      INTO v_new_alloc_total
    FROM public.payment_allocations pa
    WHERE pa.payment_id = p_payment_id;

    IF v_new_alloc_total <> v_payment.amount_cents THEN
      RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_ALLOC_TOTAL: Created % cents of allocations, expected %', v_new_alloc_total, v_payment.amount_cents;
    END IF;
  ELSIF v_alloc_count <> v_active_count THEN
    RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_ALLOC_COUNT: Created % allocations, expected %', v_alloc_count, v_active_count;
  END IF;

  -- ── 13) pending -> verified con rowcount verificado ────────
  UPDATE public.payments p
  SET status = 'verified',
      verified_at = NOW(),
      verified_by = p_actor_user_id,
      updated_at = NOW()
  WHERE p.id = p_payment_id
    AND p.status = 'pending';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_RACE: Payment status changed during verification';
  END IF;

  -- ── 14) Recalcular payment_status en la MISMA transaccion.
  --       'full': verifica el 100% del total -> fully_paid.
  --       'balance': cubre exactamente el resto -> fully_paid
  --       (MKT-010.1: AMBAS etapas verificadas recien ahi). ──
  UPDATE public.reservations r
  SET payment_status = 'fully_paid'
  WHERE r.id = v_payment.reservation_id
    AND r.source = 'marketplace';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_VERIFY_RESERVATION: Reservation payment_status update failed';
  END IF;

  -- ── 15) Auditoria payment.verified (actor agency) ─────────
  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    v_reservation.agency_id,
    'payment.verified',
    'payment',
    p_payment_id,
    jsonb_build_object('status', 'pending', 'amount_cents', v_payment.amount_cents),
    jsonb_build_object(
      'status', 'verified',
      'amount_cents', v_payment.amount_cents,
      'allocation_count', v_alloc_count
    ),
    jsonb_build_object(
      'reservation_id', v_payment.reservation_id,
      'source', v_reservation.source,
      'stage', v_stage,
      'seat_codes', to_jsonb(v_seat_codes),
      'actor_user_id', p_actor_user_id
    )
  );

  -- ── 16) Resultado estructurado ─────────────────────────────
  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'reservation_id', v_payment.reservation_id,
    'status', 'verified',
    'already_verified', false,
    'stage', v_stage,
    'amount_cents', v_payment.amount_cents,
    'currency', v_payment.currency,
    'allocation_count', v_alloc_count,
    'total_expected_cents', v_total_expected,
    'verified_at', NOW(),
    'verified_by', p_actor_user_id,
    'payment_status', 'fully_paid',
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.verify_marketplace_payment(UUID, UUID) IS
  'MKT-006 Fase 6.2B + MKT-010.1: verifica un comprobante marketplace. Actor agency con ownership: valida role=agency, obtiene agency_id del usuario (no del cliente) y verifica que el pago y la reserva pertenecen a esa agencia. En UNA transaccion bloquea payments (hoja) -> reservations -> passengers, valida estado pending+reserved y asientos coherentes, pasa el pago a verified (rowcount=1) y audita payment.verified con actor agency. MKT-010.1: stage=full (legado) exige importe = SUM(unit_price) exacto y crea UNA allocation por pasajero activo; stage=balance exige importe = total - allocations verificadas exacto (impide sobrepago y pago incompleto), crea allocations por el RESTO de cada pasajero y deja el saldo en 0 -> payment_status fully_paid. stage=deposit se rechaza (se aprueba con el intento). Reintento sobre verified devuelve already_verified sin allocations ni auditoria duplicadas. SECURITY DEFINER; EXECUTE service_role only.';

-- ============================================================
-- 7) reject_marketplace_payment (REEMPLAZA a la de 085)
-- ============================================================
CREATE OR REPLACE FUNCTION public.reject_marketplace_payment(
  p_payment_id UUID,
  p_actor_user_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_reservation public.reservations%ROWTYPE;
  v_actor public.users%ROWTYPE;
  v_reason TEXT;
  v_other_verified_count INTEGER := 0;
  v_active_count INTEGER := 0;
  v_seat_ids UUID[] := ARRAY[]::UUID[];
  v_freed_count INTEGER := 0;
  v_refund_cents INTEGER := 0;
  v_rowcount BIGINT;
  v_cancelled_reservation BOOLEAN := false;
  v_new_payment_status TEXT;
  v_outcome TEXT;
  v_audit_payment_id UUID;
  v_audit_reservation_id UUID;
  v_rec RECORD;
  v_stage TEXT;
BEGIN
  -- ── 1) Entrada + normalizacion del motivo ──────────────────
  IF p_payment_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_INPUT: p_payment_id and p_actor_user_id are required';
  END IF;

  v_reason := btrim(COALESCE(p_reason, ''));

  IF v_reason = '' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_REJECT_REASON: A rejection reason is required';
  END IF;

  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_REJECT_REASON: Rejection reason must not exceed 500 characters';
  END IF;

  -- ── 2) Bloquear el pago (hoja deadlock-safe) ───────────────
  SELECT p.*
    INTO v_payment
  FROM public.payments p
  WHERE p.id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_NOT_FOUND: Payment not found';
  END IF;

  -- ── 2b) Etapa del pago (MKT-010.1) ─────────────────────────
  v_stage := COALESCE(v_payment.stage, 'full');

  -- ── 3) Bloquear la reserva ─────────────────────────────────
  SELECT r.*
    INTO v_reservation
  FROM public.reservations r
  WHERE r.id = v_payment.reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_RESERVATION_NOT_FOUND: Reservation not found';
  END IF;

  -- ── 4) Alcance marketplace ─────────────────────────────────
  IF v_reservation.source IS DISTINCT FROM 'marketplace' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_NOT_MARKETPLACE: Payment does not belong to a marketplace reservation';
  END IF;

  -- ── 5) Autorizacion: actor agency con ownership (Fase 6.2B) ─
  --       El agency_id NUNCA llega del cliente: se resuelve del
  --       registro public.users del actor autenticado. ─────────
  SELECT u.*
    INTO v_actor
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_ADMIN_NOT_FOUND: Actor not found';
  END IF;

  IF v_actor.role IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_ADMIN_ROLE: Only agency users can reject payments';
  END IF;

  IF v_actor.agency_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_ADMIN_AGENCY: Agency user has no agency_id';
  END IF;

  -- Coherencia payments <-> reservations (defensa contra datos corruptos)
  IF v_payment.agency_id IS DISTINCT FROM v_reservation.agency_id THEN
    RAISE EXCEPTION 'ERR_PAYMENT_AGENCY_MISMATCH: Payment and reservation agency mismatch';
  END IF;

  -- Ownership: el pago y la reserva deben pertenecer a la agencia del actor
  IF v_payment.agency_id IS DISTINCT FROM v_actor.agency_id THEN
    RAISE EXCEPTION 'ERR_PAYMENT_AGENCY_MISMATCH: Payment does not belong to this agency';
  END IF;

  -- ── 6) Idempotencia: reintento vs contradiccion ────────────
  IF v_payment.status = 'rejected' THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment.id,
      'reservation_id', v_payment.reservation_id,
      'status', 'rejected',
      'already_rejected', true,
      'stage', v_stage,
      'rejection_reason', v_payment.rejection_reason,
      'reservation_status', v_reservation.status,
      'outcome', CASE WHEN v_reservation.status = 'cancelled'
                      THEN 'cancelled_reservation' ELSE 'rejected_only' END
    );
  END IF;

  IF v_payment.status = 'verified' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_VERIFIED_NO_REJECT: A verified payment cannot be rejected';
  END IF;

  IF v_payment.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_NOT_PENDING: Payment is in status %', v_payment.status;
  END IF;

  -- ── 7) Pago inicial vs abono: ¿existen otros pagos verified? ─
  SELECT COUNT(*)
    INTO v_other_verified_count
  FROM public.payments p
  WHERE p.reservation_id = v_payment.reservation_id
    AND p.status = 'verified'
    AND p.id <> p_payment_id;

  -- MKT-010.1: la cancelacion SOLO existe para el pago total
  -- legado (stage='full') sin otros pagos verificados. Un pago
  -- de SALDO (stage='balance') jamas cancela la reserva ni
  -- libera asientos: el saldo vencido es decision de la agencia
  -- y el sistema NUNCA auto-cancela.
  IF v_other_verified_count = 0 AND v_stage = 'full' THEN
    -- ── PAGO INICIAL (etapa unica): cancelar la reserva marketplace ─
    IF v_reservation.status = 'reserved' THEN

      -- 7a) Pasajeros activos con FOR UPDATE (orden por seat_id).
      FOR v_rec IN
        SELECT rp.id, rp.seat_id
        FROM public.reservation_passengers rp
        WHERE rp.reservation_id = v_payment.reservation_id
          AND rp.status = 'active'
        ORDER BY rp.seat_id
        FOR UPDATE
      LOOP
        v_active_count := v_active_count + 1;
        v_seat_ids := v_seat_ids || v_rec.seat_id;
      END LOOP;

      -- 7b) Cancelar los pasajeros activos (rowcount verificado).
      IF v_active_count > 0 THEN
        UPDATE public.reservation_passengers rp
        SET status = 'cancelled'
        WHERE rp.reservation_id = v_payment.reservation_id
          AND rp.status = 'active';

        GET DIAGNOSTICS v_rowcount = ROW_COUNT;

        IF v_rowcount <> v_active_count THEN
          RAISE EXCEPTION 'ERR_PAYMENT_REJECT_PASSENGERS: Cancelled % passengers, expected %', v_rowcount, v_active_count;
        END IF;

        -- 7c) Liberar sus asientos (mismo cleanup que 079: limpia TODA
        --     la metadata de lock). Idempotente: un asiento ya liberado
        --     no aborta; solo se registra cuantos se liberaron.
        UPDATE public.seats s
        SET status = 'available',
            locked_by = NULL,
            locked_at = NULL,
            lock_expires_at = NULL,
            guest_session_id = NULL,
            updated_at = NOW()
        WHERE s.id = ANY(v_seat_ids)
          AND s.status IN ('reserved', 'locked');

        GET DIAGNOSTICS v_freed_count = ROW_COUNT;
      END IF;

      -- 7d) Cancelar la reserva (rowcount verificado). reservations NO
      --      tiene updated_at; no se setea ninguno.
      UPDATE public.reservations r
      SET status = 'cancelled',
          payment_status = 'cancelled'
      WHERE r.id = v_payment.reservation_id
        AND r.status = 'reserved';

      GET DIAGNOSTICS v_rowcount = ROW_COUNT;

      IF v_rowcount <> 1 THEN
        RAISE EXCEPTION 'ERR_PAYMENT_REJECT_RESERVATION: Reservation cancel failed (status changed concurrently)';
      END IF;

      v_cancelled_reservation := true;
      v_new_payment_status := 'cancelled';

    ELSIF v_reservation.status = 'cancelled' THEN
      -- Ya cancelada (idempotencia / carrera): solo marcar payment_status.
      UPDATE public.reservations r
      SET payment_status = 'cancelled'
      WHERE r.id = v_payment.reservation_id;

      v_cancelled_reservation := true;
      v_new_payment_status := 'cancelled';

    ELSE
      RAISE EXCEPTION 'ERR_PAYMENT_RESERVATION_STATE: Reservation is in status %, cannot cancel', v_reservation.status;
    END IF;

    -- 7e) Refunds: solo dinero VERIFICADO. Un pago initial rechazado era
    --     'pending' (sin allocations) y no existen otros pagos verified,
    --     asi que v_refund_cents = 0 y NO se crea un refund artificial
    --     de importe cero (regla de negocio). Se calcula por defensa.
    SELECT COALESCE(SUM(pa.amount_cents), 0)
      INTO v_refund_cents
    FROM public.payment_allocations pa
    JOIN public.payments p
      ON p.id = pa.payment_id
     AND p.status = 'verified'
    WHERE pa.reservation_id = v_payment.reservation_id;

    v_outcome := 'cancelled_reservation';

  ELSE
    -- ── ABONO FUTURO (existen otros pagos verified) o etapa de
    --     SALDO (MKT-010.1): NO cancelar. Solo se rechaza este
    --     pago y se recalcula payment_status (el saldo rechazado
    --     deja la reserva en 'partial'; los asientos siguen
    --     reservados para reintentar).
    v_cancelled_reservation := false;
    v_outcome := 'rejected_only';
  END IF;

  -- ── 8) pending -> rejected con rowcount verificado ─────────
  UPDATE public.payments p
  SET status = 'rejected',
      rejection_reason = v_reason,
      updated_at = NOW()
  WHERE p.id = p_payment_id
    AND p.status = 'pending';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_REJECT_RACE: Payment status changed during rejection';
  END IF;

  -- ── 9) Recalcular payment_status (solo camino abono; el camino
  --       de cancelacion ya lo dejo en 'cancelled'). ──────────
  IF NOT v_cancelled_reservation THEN
    SELECT CASE
             WHEN v_verified = 0 THEN 'pending'
             WHEN v_verified >= v_expected THEN 'fully_paid'
             ELSE 'partial'
           END
      INTO v_new_payment_status
    FROM (
      SELECT
        (SELECT COALESCE(SUM(rp.unit_price), 0)
           FROM public.reservation_passengers rp
          WHERE rp.reservation_id = v_payment.reservation_id
            AND rp.status = 'active') AS v_expected,
        (SELECT COALESCE(SUM(pa.amount_cents), 0)
           FROM public.payment_allocations pa
           JOIN public.payments p
             ON p.id = pa.payment_id
            AND p.status = 'verified'
           JOIN public.reservation_passengers rp
             ON rp.id = pa.reservation_passenger_id
          WHERE rp.reservation_id = v_payment.reservation_id
            AND rp.status = 'active') AS v_verified
    ) t;

    UPDATE public.reservations r
    SET payment_status = v_new_payment_status
    WHERE r.id = v_payment.reservation_id
      AND r.source = 'marketplace';
  END IF;

  -- ── 10) Auditoria payment.rejected (siempre) ───────────────
  v_audit_payment_id := public.audit_append(
    p_actor_user_id,
    'agency',
    v_reservation.agency_id,
    'payment.rejected',
    'payment',
    p_payment_id,
    jsonb_build_object('status', 'pending', 'amount_cents', v_payment.amount_cents),
    jsonb_build_object('status', 'rejected', 'rejection_reason', v_reason),
    jsonb_build_object(
      'reservation_id', v_payment.reservation_id,
      'source', v_reservation.source,
      'stage', v_stage,
      'outcome', v_outcome,
      'actor_user_id', p_actor_user_id
    )
  );

  -- ── 11) Auditoria reservation.cancelled (solo si se cancelo) ─
  IF v_cancelled_reservation THEN
    v_audit_reservation_id := public.audit_append(
      p_actor_user_id,
      'agency',
      v_reservation.agency_id,
      'reservation.cancelled',
      'reservation',
      v_payment.reservation_id,
      jsonb_build_object('status', 'reserved'),
      jsonb_build_object('status', 'cancelled'),
      jsonb_build_object(
        'source', v_reservation.source,
        'freed_seat_count', v_freed_count,
        'cancelled_passenger_count', v_active_count,
        'reason', v_reason,
        'trigger', 'payment_rejected',
        'payment_id', p_payment_id,
        'actor_user_id', p_actor_user_id
      )
    );
  END IF;

  -- ── 12) Resultado estructurado ─────────────────────────────
  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'reservation_id', v_payment.reservation_id,
    'status', 'rejected',
    'already_rejected', false,
    'stage', v_stage,
    'rejection_reason', v_reason,
    'outcome', v_outcome,
    'cancelled_reservation', v_cancelled_reservation,
    'reservation_status', CASE WHEN v_cancelled_reservation
                               THEN 'cancelled' ELSE v_reservation.status END,
    'payment_status', v_new_payment_status,
    'freed_seat_count', v_freed_count,
    'cancelled_passenger_count', v_active_count,
    'refund_required', v_refund_cents > 0,
    'refund_amount_cents', v_refund_cents,
    'payment_audit_id', v_audit_payment_id,
    'reservation_audit_id', v_audit_reservation_id
  );
END;
$$;

COMMENT ON FUNCTION public.reject_marketplace_payment(UUID, UUID, TEXT) IS
  'MKT-006 Fase 6.2B + MKT-010.1: rechaza un comprobante marketplace. Actor agency con ownership: valida role=agency, obtiene agency_id del usuario (no del cliente) y verifica que el pago y la reserva pertenecen a esa agencia. Valida motivo (1-500 chars), bloquea payments (hoja) -> reservations, estado pending. Si es el pago INITIAL (sin otros verified) cancela la reserva reserved de forma atomica (pasajeros -> cancelled, seats -> available limpiando lock, reservation -> cancelled + payment_status) y NO crea refunds artificiales de importe cero. Si es un abono futuro (otros verified existen) NO cancela la reserva; solo rechaza y recalcula payment_status. Un verified nunca se rechaza (error). Reintento sobre rejected devuelve already_rejected sin efectos duplicados. Audita payment.rejected (actor agency) y, si cancelo, reservation.cancelled. MKT-010.1: la cancelacion solo aplica a stage=''full'' sin otros pagos verificados; un pago de saldo (stage=''balance'') o un abono nunca cancela la reserva ni libera asientos (v_outcome=rejected_only) y el saldo vencido jamas dispara auto-cancelacion. SECURITY DEFINER; EXECUTE service_role only.';

-- ============================================================
-- 3) Privilegios (mismo patron que 081/082/083)
-- ============================================================

REVOKE ALL ON FUNCTION public.verify_marketplace_payment(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_marketplace_payment(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.verify_marketplace_payment(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_marketplace_payment(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.reject_marketplace_payment(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_marketplace_payment(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.reject_marketplace_payment(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reject_marketplace_payment(UUID, UUID, TEXT) TO service_role;

-- ============================================================
-- 8) submit_reservation_balance_payment (NUEVO)
--    El cliente somete el comprobante del SALDO (etapa 2).
--
--    * Identidad y ownership: customer de la sesion; la reserva
--      debe existir, ser suya y ser de origen 'marketplace'.
--    * Importe SERVER-SIDE: saldo = SUM(unit_price de pasajeros
--      activos) - SUM(allocations verificadas). El cliente NUNCA
--      envia importes; un importe de mas o de menos es imposible.
--    * Requiere un deposito ya VERIFICADO (plan en dos partes) y
--      saldo > 0, si no ERR_BALANCE_ALREADY_SETTLED.
--    * Idempotencia por clave con namespace propio
--      'mkt010_1:<reservation>:<key>'; ademas UN solo saldo
--      pendiente a la vez (ERR_BALANCE_PAYMENT_PENDING), todo
--      serializado con el lock de la reserva (orden 046:
--      reservations -> passengers; no se tocan seats).
--    * Escribe payments (stage='balance', status='pending') y la
--      auditoria 'payment.submitted' (actor system, cliente en
--      metadata). NO escribe reservations ni seats: los asientos
--    permanecen reservados esperando el saldo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_reservation_balance_payment(
  p_reservation_id UUID,
  p_customer_id UUID,
  p_idempotency_key UUID,
  p_proof_path TEXT,
  p_payment_reference TEXT,
  p_bank_origin TEXT,
  p_payment_datetime TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_existing public.payments%ROWTYPE;
  v_namespace TEXT;
  v_path_prefix TEXT;
  v_path_rest TEXT;
  v_pax RECORD;
  v_active_count INTEGER := 0;
  v_priced_count INTEGER := 0;
  v_total INTEGER := 0;
  v_paid INTEGER := 0;
  v_balance INTEGER := 0;
  v_deposit_verified BOOLEAN := false;
  v_payment_id UUID;
  v_submitted_at TIMESTAMPTZ;
  v_constraint TEXT;
  v_reference TEXT;
  v_bank TEXT;
BEGIN
  -- 1) Entrada: identidad, clave, conciliacion y ruta. ---------
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CUSTOMER_REQUIRED: An authenticated customer is required';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_INPUT: p_idempotency_key is required';
  END IF;

  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_RESERVATION_NOT_FOUND: Reservation not found';
  END IF;

  IF p_payment_datetime IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_RECONCILIATION: payment datetime is required';
  END IF;

  v_reference := btrim(COALESCE(p_payment_reference, ''));
  IF v_reference = '' OR length(v_reference) > 100 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_RECONCILIATION: payment reference is required (max 100 characters)';
  END IF;

  v_bank := btrim(COALESCE(p_bank_origin, ''));
  IF v_bank = '' OR length(v_bank) > 120 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_RECONCILIATION: bank origin is required (max 120 characters)';
  END IF;

  -- La ruta la compone el backend como
  -- <reservation_id>/<sha256>.<ext> (mismo directorio que el flujo
  -- 083): sin '..' sin subcarpetas y solo extensiones validas.
  v_path_prefix := p_reservation_id::text || '/';

  IF p_proof_path IS NULL
     OR length(p_proof_path) > 512
     OR left(p_proof_path, length(v_path_prefix)) <> v_path_prefix THEN
    RAISE EXCEPTION 'ERR_PAYMENT_INPUT: p_proof_path must live inside the reservation directory';
  END IF;

  v_path_rest := substr(p_proof_path, length(v_path_prefix) + 1);

  IF v_path_rest = ''
     OR v_path_rest LIKE '%..%'
     OR v_path_rest LIKE '%/%'
     OR v_path_rest !~ '\.(png|jpg|jpeg|webp|pdf)$' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_INPUT: p_proof_path has an invalid proof filename';
  END IF;

  -- 2) Reserva con lock de fila (orden 046: reservations ->
  --    passengers). Ningun otro lock es necesario: esta funcion no
  --    escribe seats ni passengers. ------------------------------
  SELECT r.*
    INTO v_reservation
  FROM public.reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_RESERVATION_NOT_FOUND: Reservation not found';
  END IF;

  IF v_reservation.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'ERR_PAYMENT_NOT_OWNER: The reservation does not belong to this customer';
  END IF;

  -- Reservas internal (tour): fuera del flujo marketplace.
  IF v_reservation.source IS DISTINCT FROM 'marketplace' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_RESERVATION_NOT_FOUND: Reservation not found';
  END IF;

  -- 3) Idempotencia ANTES de calcular: un reintento con la misma
  --    clave devuelve el pago existente sin calcular ni escribir. -
  v_namespace := 'mkt010_1:' || p_reservation_id::text || ':' || p_idempotency_key::text;

  SELECT p.*
    INTO v_existing
  FROM public.payments p
  WHERE p.idempotency_key = v_namespace;

  IF FOUND THEN
    IF v_existing.proof_url IS DISTINCT FROM p_proof_path
       OR v_existing.reservation_id IS DISTINCT FROM p_reservation_id
       OR v_existing.customer_id IS DISTINCT FROM p_customer_id
       OR v_existing.external_reference IS DISTINCT FROM v_reference THEN
      RAISE EXCEPTION 'ERR_PAYMENT_IDEMPOTENCY_CONFLICT: Idempotency key reused with a different submission';
    END IF;

    RETURN jsonb_build_object(
      'payment_id', v_existing.id,
      'reservation_id', v_existing.reservation_id,
      'status', v_existing.status,
      'stage', v_existing.stage,
      'amount_cents', v_existing.amount_cents,
      'currency', v_existing.currency,
      'proof_url', v_existing.proof_url,
      'submitted_at', v_existing.submitted_at,
      'idempotent', true
    );
  END IF;

  -- 4) Etapa 1 verificada: sin deposito aprobado no existe saldo
  --    que cobrar (plan en dos partes). ------------------------
  SELECT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.reservation_id = p_reservation_id
      AND p.status = 'verified'
      AND p.stage = 'deposit'
  ) INTO v_deposit_verified;

  IF NOT v_deposit_verified THEN
    RAISE EXCEPTION 'ERR_BALANCE_NOT_AVAILABLE: No verified deposit exists for this reservation';
  END IF;

  -- 5) Pasajeros activos con FOR UPDATE (orden 046). -----------
  FOR v_pax IN
    SELECT rp.unit_price
    FROM public.reservation_passengers rp
    WHERE rp.reservation_id = p_reservation_id
      AND rp.status = 'active'
    ORDER BY rp.seat_id
    FOR UPDATE
  LOOP
    v_active_count := v_active_count + 1;

    IF v_pax.unit_price IS NOT NULL AND v_pax.unit_price > 0 THEN
      v_priced_count := v_priced_count + 1;
      v_total := v_total + v_pax.unit_price;
    END IF;
  END LOOP;

  IF v_active_count = 0 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_AMOUNT_INVALID: Reservation has no active passengers to charge';
  END IF;

  IF v_priced_count <> v_active_count OR v_total <= 0 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_AMOUNT_INVALID: Reservation amount must be a positive SUM(unit_price)';
  END IF;

  -- 6) Lo ya verificado (deposito + cualquier saldo previo) y el
  --    saldo restante, calculado AQUI, en el servidor. ---------
  SELECT COALESCE(SUM(pa.amount_cents), 0)
    INTO v_paid
  FROM public.payment_allocations pa
  JOIN public.payments p
    ON p.id = pa.payment_id
   AND p.status = 'verified'
  WHERE pa.reservation_id = p_reservation_id;

  v_balance := v_total - v_paid;

  IF v_balance <= 0 THEN
    RAISE EXCEPTION 'ERR_BALANCE_ALREADY_SETTLED: The reservation balance is already settled';
  END IF;

  -- 7) Un solo saldo en revision a la vez. El lock de la reserva
  --    (paso 2) serializa estos envios: el segundo ni llega aqui.
  IF EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.reservation_id = p_reservation_id
      AND p.stage = 'balance'
      AND p.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'ERR_BALANCE_PAYMENT_PENDING: A balance payment is already under review';
  END IF;

  -- 8) Pago pendiente del saldo: importe, moneda y ruta
  --    server-side. El indice payments.idempotency_key es el
  --    backstop; el handler solo acepta exito idempotente si la
  --    fila existente valida reserva + customer + clave + ruta. --
  BEGIN
    INSERT INTO public.payments (
      reservation_id,
      agency_id,
      customer_id,
      provider,
      external_reference,
      bank_origin,
      payment_datetime,
      amount_cents,
      currency,
      status,
      proof_url,
      stage,
      idempotency_key
    )
    VALUES (
      p_reservation_id,
      v_reservation.agency_id,
      p_customer_id,
      'manual',
      v_reference,
      v_bank,
      p_payment_datetime,
      v_balance,
      'COP',
      'pending',
      p_proof_path,
      'balance',
      v_namespace
    )
    RETURNING id, submitted_at INTO v_payment_id, v_submitted_at;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;

      IF v_constraint IS DISTINCT FROM 'payments_idempotency_key' THEN
        RAISE;
      END IF;

      SELECT p.*
        INTO v_existing
      FROM public.payments p
      WHERE p.idempotency_key = v_namespace;

      IF FOUND
         AND v_existing.reservation_id = p_reservation_id
         AND v_existing.customer_id = p_customer_id
         AND v_existing.proof_url = p_proof_path THEN
        RETURN jsonb_build_object(
          'payment_id', v_existing.id,
          'reservation_id', v_existing.reservation_id,
          'status', v_existing.status,
          'stage', v_existing.stage,
          'amount_cents', v_existing.amount_cents,
          'currency', v_existing.currency,
          'proof_url', v_existing.proof_url,
          'submitted_at', v_existing.submitted_at,
          'idempotent', true
        );
      END IF;

      RAISE EXCEPTION 'ERR_PAYMENT_IDEMPOTENCY_CONFLICT: Idempotency key reused with a different submission';
  END;

  -- 9) Auditoria: 'payment.submitted' exige actor system con
  --    actor_user_id NULL (guard de 065); el cliente queda en la
  --    metadata. La accion ya esta en el CHECK desde arriba. ----
  PERFORM public.audit_append(
    NULL,
    'system',
    v_reservation.agency_id,
    'payment.submitted',
    'payment',
    v_payment_id,
    NULL,
    jsonb_build_object(
      'status', 'pending',
      'stage', 'balance',
      'amount_cents', v_balance
    ),
    jsonb_build_object(
      'source', 'marketplace',
      'customer_id', p_customer_id,
      'reservation_id', p_reservation_id,
      'idempotency_key', p_idempotency_key,
      'trigger', 'mkt010_1_balance'
    )
  );

  -- 10) Resultado. NO se escribe reservations ni seats. --------
  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'reservation_id', p_reservation_id,
    'status', 'pending',
    'stage', 'balance',
    'amount_cents', v_balance,
    'currency', 'COP',
    'proof_url', p_proof_path,
    'payment_reference', v_reference,
    'bank_origin', v_bank,
    'payment_datetime', p_payment_datetime,
    'submitted_at', v_submitted_at,
    'total_cents', v_total,
    'paid_cents', v_paid,
    'balance_cents', v_balance,
    'idempotent', false
  );
END;
$$;

COMMENT ON FUNCTION public.submit_reservation_balance_payment(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) IS
  'MKT-010.1: somete el comprobante del SALDO (etapa 2) de una reserva marketplace. Importe server-side (SUM(unit_price) - allocations verificadas); requiere deposito verificado y saldo > 0 (ERR_BALANCE_ALREADY_SETTLED). Idempotencia por clave namespace mkt010_1 y un solo saldo pendiente a la vez (ERR_BALANCE_PAYMENT_PENDING), serializado con el lock de la reserva. NO escribe reservations ni seats (los asientos permanecen reservados). Auditoria payment.submitted (actor system). EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.submit_reservation_balance_payment(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_reservation_balance_payment(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.submit_reservation_balance_payment(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_reservation_balance_payment(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- ============================================================
-- 9) reservation_payment_progress (NUEVO)
--    Progreso de pago de UNA reserva para su cliente (p_customer_id
--    obligatorio cuando lo llama el Marketplace) o para la agencia
--    (sin customer_id: la autorizacion la hace el backend).
--
--    * Montos y porcentajes server-side: deposito y saldo son
--      fracciones del total; nunca se inventan en el cliente.
--    * plan='two_stage' ⇔ existe un pago stage='deposit'
--      verificado (la reserva solo nace al aprobarse el deposito).
--    * Vencimientos leidos EN VIVO de la viaja.
--    * overdue es SOLO informativo: jamas cancela ni libera
--      asientos (seats_held lo dice).
-- ============================================================

CREATE OR REPLACE FUNCTION public.reservation_payment_progress(
  p_reservation_id UUID,
  p_customer_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_active_count INTEGER := 0;
  v_priced_count INTEGER := 0;
  v_total INTEGER := 0;
  v_paid INTEGER := 0;
  v_balance INTEGER := 0;
  v_deposit_cents INTEGER;
  v_deposit_verified_at TIMESTAMPTZ;
  v_plan TEXT := 'single';
  v_deposit_deadline TIMESTAMPTZ;
  v_balance_deadline TIMESTAMPTZ;
  v_deposit_pct INTEGER;
  v_balance_pct INTEGER;
  v_deposit_overdue BOOLEAN := false;
  v_balance_overdue BOOLEAN := false;
  v_payments JSONB;
  v_agency_name TEXT;
  v_whatsapp TEXT;
BEGIN
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_PROGRESS_INPUT: p_reservation_id is required';
  END IF;

  SELECT r.*
    INTO v_reservation
  FROM public.reservations r
  WHERE r.id = p_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_PROGRESS_NOT_FOUND: Reservation not found';
  END IF;

  -- Ownership: si llega customer_id (Marketplace) debe ser el
  -- dueno; sin customer_id autoriza el backend (agencia).
  IF p_customer_id IS NOT NULL
     AND v_reservation.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'ERR_PAYMENT_PROGRESS_NOT_FOUND: Reservation not found';
  END IF;

  -- 1) Pasajeros activos -> total del contrato (snapshot
  --    unit_price, nunca trips.seat_price).
  SELECT COUNT(*),
         COUNT(rp.unit_price),
         COALESCE(SUM(rp.unit_price), 0)
    INTO v_active_count, v_priced_count, v_total
  FROM public.reservation_passengers rp
  WHERE rp.reservation_id = p_reservation_id
    AND rp.status = 'active';

  IF v_active_count = 0 OR v_priced_count <> v_active_count OR v_total <= 0 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_PROGRESS_AMOUNT: Reservation has no consistent active passenger amounts';
  END IF;

  -- 2) Lo ya verificado: allocations de pagos verified.
  SELECT COALESCE(SUM(pa.amount_cents), 0)
    INTO v_paid
  FROM public.payment_allocations pa
  JOIN public.payments p
    ON p.id = pa.payment_id
   AND p.status = 'verified'
  WHERE pa.reservation_id = p_reservation_id;

  v_balance := GREATEST(v_total - v_paid, 0);

  -- 3) Plan: deposito verificado => dos partes.
  SELECT p.amount_cents, p.verified_at
    INTO v_deposit_cents, v_deposit_verified_at
  FROM public.payments p
  WHERE p.reservation_id = p_reservation_id
    AND p.status = 'verified'
    AND p.stage = 'deposit'
  ORDER BY p.verified_at NULLS LAST
  LIMIT 1;

  IF FOUND AND v_deposit_cents IS NOT NULL THEN
    v_plan := 'two_stage';
  ELSE
    v_deposit_cents := NULL;
    v_deposit_verified_at := NULL;
  END IF;

  -- 4) Vencimientos EN VIVO de la viaja (la agencia puede
  --    ajustarlos, p. ej. al postergar la salida).
  SELECT t.deposit_deadline, t.balance_deadline
    INTO v_deposit_deadline, v_balance_deadline
  FROM public.trips t
  WHERE t.id = v_reservation.trip_id;

  -- 5) Porcentajes server-side del TOTAL. Solo existen en el plan
  --    de dos partes; en single son NULL (no hay etapas).
  IF v_plan = 'two_stage' THEN
    v_deposit_pct := ROUND((v_deposit_cents * 100.0) / v_total)::INTEGER;
    v_balance_pct := 100 - v_deposit_pct;

    v_deposit_overdue := v_deposit_verified_at IS NULL
      AND v_deposit_deadline IS NOT NULL
      AND v_deposit_deadline < NOW();
  END IF;

  v_balance_overdue := v_balance > 0
    AND v_balance_deadline IS NOT NULL
    AND v_balance_deadline < NOW();

  -- 6) Pagos de esta reserva, en orden estable, con su etapa.
  SELECT COALESCE(jsonb_agg(x ORDER BY submitted_at, id), '[]'::jsonb)
    INTO v_payments
  FROM (
    SELECT jsonb_build_object(
             'id', p.id,
             'stage', p.stage,
             'status', p.status,
             'amount_cents', p.amount_cents,
             'currency', p.currency,
             'external_reference', p.external_reference,
             'bank_origin', p.bank_origin,
             'payment_datetime', p.payment_datetime,
             'submitted_at', p.submitted_at,
             'verified_at', p.verified_at,
             'rejection_reason', p.rejection_reason
           ) AS x,
           p.submitted_at,
           p.id
    FROM public.payments p
    WHERE p.reservation_id = p_reservation_id
  ) sub;

  -- 7) Canal de WhatsApp de la agencia: contacto publico y activo
  --    con canal whatsapp (091), con fallback al telefono legado
  --    de agencies (006/011).
  SELECT a.name
    INTO v_agency_name
  FROM public.agencies a
  WHERE a.id = v_reservation.agency_id;

  SELECT c.phone
    INTO v_whatsapp
  FROM public.agency_contacts c
  WHERE c.agency_id = v_reservation.agency_id
    AND c.channel = 'whatsapp'
    AND c.is_active
    AND c.is_public
    AND c.deleted_at IS NULL
  ORDER BY c.sort_order, c.created_at
  LIMIT 1;

  IF v_whatsapp IS NULL THEN
    SELECT a.phone
      INTO v_whatsapp
    FROM public.agencies a
    WHERE a.id = v_reservation.agency_id;
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', v_reservation.id,
    'reservation_status', v_reservation.status,
    'payment_status', v_reservation.payment_status,
    'plan', v_plan,
    'passenger_count', v_active_count,
    'total_cents', v_total,
    'deposit_cents', v_deposit_cents,
    'deposit_verified_at', v_deposit_verified_at,
    'paid_cents', v_paid,
    'balance_cents', v_balance,
    'deposit_pct', v_deposit_pct,
    'balance_pct', v_balance_pct,
    'deposit_deadline', CASE WHEN v_plan = 'two_stage' THEN v_deposit_deadline ELSE NULL END,
    'balance_deadline', CASE WHEN v_plan = 'two_stage' THEN v_balance_deadline ELSE NULL END,
    'deposit_overdue', v_deposit_overdue,
    'balance_overdue', v_balance_overdue,
    'seats_held', v_reservation.status = 'reserved',
    'payments', v_payments,
    'agency', jsonb_build_object(
      'id', v_reservation.agency_id,
      'name', v_agency_name,
      'whatsapp_phone', v_whatsapp
    )
  );
END;
$$;

COMMENT ON FUNCTION public.reservation_payment_progress(UUID, UUID) IS
  'MKT-010.1: progreso de pago de una reserva (total, deposito, pagado, saldo restante, porcentajes server-side, vencimientos en vivo e informacion de WhatsApp de la agencia). plan=two_stage ⇔ existe deposito verificado. overdue es SOLO informativo: nunca cancela ni libera asientos (seats_held informa que siguen reservados). Con p_customer_id exige ownership; sin el, autoriza el backend. EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.reservation_payment_progress(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reservation_payment_progress(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.reservation_payment_progress(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_payment_progress(UUID, UUID) TO service_role;
