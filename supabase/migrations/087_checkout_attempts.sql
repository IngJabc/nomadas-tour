-- ============================================================
-- 087_checkout_attempts.sql
-- MKT-007 - Checkout pendiente de revision y aprobacion del pago.
--
-- Objetivo:
--   Sustituir el flujo B2C que creaba una reserva definitiva antes de
--   que la agencia revisara el comprobante. A partir de MKT-007 el
--   cliente crea un CHECKOUT ATTEMPT (intento de compra). La reserva
--   definitiva, sus pasajeros, el pago VERIFICADO y sus allocations
--   nacen UNICAMENTE dentro de verify_checkout_attempt, en una sola
--   transaccion PostgreSQL.
--
-- Contexto (migraciones ya existentes, NO se modifican):
--   011 seats/reservations/reservation_passengers + update_updated_at().
--   065 audit_append() y audit_log (actor guard: system|superadmin|agency).
--   068 seats.lock_expires_at + trg_seats_clear_lock_on_available.
--   069 create_reservation_core (TOUR: status='confirmed'; prohibido aqui).
--   075 reservations.customer_id/source/payment_status y estados del
--       ciclo marketplace ('locked','reserved').
--   076 trips.seat_price, reservation_passengers.unit_price, payments
--       (amount_cents INTEGER centavos, status pending|verified|rejected,
--       idempotency_key UNIQUE, external_reference) y allocations.
--   079 actor_role 'customer' permitido en audit_log; INSERT directo
--       porque audit_append() rechaza 'customer'.
--   080 guest_sessions + seats.guest_session_id +
--       seats_single_lock_owner_check (locked => exactamente un dueno).
--   081 create_marketplace_reservation: crea la reserva 'locked' ANTES
--       del comprobante. CON MKT-007 deja de ser invocable.
--   082 outbox: INSERT marketplace con status='reserved' emite
--       reservation.created (dedup_key); UPDATE locked->reserved tambien.
--       El INSERT directo con status='reserved' YA emite el evento.
--   083 submit_marketplace_payment: creaba payments 'pending' y
--       promovia reservations locked->reserved ANTES de la revision.
--       CON MKT-007 deja de ser invocable.
--   084 trips.seat_price persistido por create_trip/update_trip.
--   085 verify/reject_marketplace_payment (revision por payment_id).
--   086 CHECK de audit_log con payment.verified/payment.rejected.
--
-- Orden de migraciones (resuelto sobre los archivos locales):
--   El Supabase CLI aplica los archivos en orden lexicografico del
--   prefijo numerico: ... 084 -> 085 -> 086 -> 087. Ese orden es
--   VALIDO y no requiere renombrar nada:
--     * 085 solo llama a audit_append() DENTRO del cuerpo de las
--       funciones (085:338, 085:658, 085:677); no escribe auditoria
--       en tiempo de migracion. Su cabecera (085:76-78) exige que 086
--       este aplicado ANTES DE EJECUTAR las RPC, no antes de crearlas,
--       y "ambas en el mismo release".
--     * 086 solo altera CHECKs; su guard admite el estado de 079.
--     * 087 amplia esos CHECKs, por lo que DEBE ir despues de 086.
--   Instalacion limpia e incremental: `supabase db push` aplica
--   001..087 en orden sin ningun paso manual. Ver
--   docs/TUTORIAL-SUPABASE-MIGRACIONES.md.
--   Release unico: 085 + 086 + 087 viajan juntos.
--
-- Constantes de negocio:
--   Ventana inicial: hereda el TTL restante de los locks (900 s en
--     Marketplace, LOCK_TTL_SECONDS). El cliente NO puede prolongarla.
--   Ventana de revision: 24 horas contadas desde cada envio de
--     comprobante (CHECKOUT_REVIEW_WINDOW).
--   Maximo de comprobantes por intento: 3 (uno inicial + dos
--     reenvios), CHECKOUT_MAX_PROOFS.
--
-- Orden de locks (deadlock-safe):
--   checkout_attempts (hoja) FOR UPDATE -> seats FOR UPDATE
--   (ORDER BY id). verify ademas INSERTa reservations,
--   reservation_passengers, payments y payment_allocations (filas
--   nuevas, sin lock de fila previo). Ningun flujo existente toma
--   FOR UPDATE sobre una fila de checkout_attempts, por lo que el
--   intento es una hoja que no puede participar en un ciclo.
--
-- Validacion de contenido del comprobante:
--   Las RPC validan la RUTA del objeto (prefijo del intento, sin
--   '..', sin subcarpetas, extension permitida). NO validan los bytes
--   del archivo: esa validacion (magic bytes + coherencia MIME + 5 MiB)
--   ocurre en el backend de Marketplace antes de subir al bucket
--   payment-proofs. No afirmar lo contrario.
--
-- Privilegios:
--   checkout_attempts: RLS habilitada, deny-by-default, solo
--   service_role (mismo patron que guest_sessions 080 y
--   boarding_attempts 045). Las RPC: SECURITY DEFINER + EXECUTE solo
--   service_role (mismo patron que 081/083/085).
--
-- Prohibido en esta migracion:
--   Editar o renombrar 001-086; tocar RPCs de tour; tocar TTLs; tocar
--   los CHECK de seats; tocar policies; BEGIN/COMMIT; SQL de rollback.
--
-- Dry-run:   BEGIN;  \i 087_checkout_attempts.sql   ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) Conciliacion de pagos: referencias capturadas en el intento y
--    transferidas al pago definitivo al aprobar.
--    - payments.external_reference (076) ya existe: ahi vive la
--      REFERENCIA DEL PAGO. No se duplica la columna.
--    - bank_origin y payment_datetime no existian en 076-086.
-- ============================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS bank_origin TEXT,
  ADD COLUMN IF NOT EXISTS payment_datetime TIMESTAMPTZ;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_bank_origin_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_bank_origin_check
  CHECK (bank_origin IS NULL OR char_length(bank_origin) <= 120);

COMMENT ON COLUMN public.payments.bank_origin IS
  'MKT-007: banco de origen del comprobante, capturado en checkout_attempts y transferido al aprobar.';
COMMENT ON COLUMN public.payments.payment_datetime IS
  'MKT-007: fecha y hora declaradas del pago, capturadas en checkout_attempts y transferidas al aprobar.';
COMMENT ON COLUMN public.payments.external_reference IS
  'Referencia del pago. En MKT-007 proviene de checkout_attempts.payment_reference.';

-- ============================================================
-- 2) audit_log: ampliacion ADITIVA de CHECKs (patron guard de 086).
--    Acciones nuevas: checkout.verified / checkout.rejected /
--    checkout.expired / checkout.cancelled.
--    Entidad nueva: checkout_attempt.
--    audit_log_actor_check NO se toca (065/079 ya admiten system,
--    superadmin, agency y customer).
-- ============================================================

-- 2a) Guard de acciones: falla con ruido si el CHECK vigente contiene
--     una accion que 087 no conoce (migracion posterior a 086).
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
    'checkout.verified',
    'checkout.rejected',
    'checkout.expired',
    'checkout.cancelled'
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
        RAISE EXCEPTION 'ERR_087_ACTION_GUARD: audit_log_action_check contiene la accion "%" que 087 no conoce. Una migracion posterior agrego valores; mergear manualmente antes de aplicar 087.', v_lit;
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
      'checkout.verified',
      'checkout.rejected',
      'checkout.expired',
      'checkout.cancelled'
    )
  );

COMMENT ON CONSTRAINT audit_log_action_check ON public.audit_log IS
  '065 + 069 + 079 (16) + 086 payment (2) + 087 checkout (4). Aditivo: no quitar valores.';

-- 2b) Guard de entidades.
DO $$
DECLARE
  v_current TEXT;
  v_lit TEXT;
  v_known TEXT[] := ARRAY[
    'trip',
    'reservation',
    'reservation_passenger',
    'agency_settings',
    'notification_preferences',
    'reservation_link',
    'payment',
    'checkout_attempt'
  ];
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_current
  FROM pg_constraint
  WHERE conrelid = 'public.audit_log'::regclass
    AND conname = 'audit_log_entity_type_check';

  IF v_current IS NOT NULL THEN
    FOR v_lit IN
      SELECT x[1]
      FROM regexp_matches(v_current, $re$'([^']+)'$re$, 'g') AS r(x)
    LOOP
      IF NOT (v_lit = ANY(v_known)) THEN
        RAISE EXCEPTION 'ERR_087_ENTITY_GUARD: audit_log_entity_type_check contiene el valor "%" que 087 no conoce. Una migracion posterior agrego valores; mergear manualmente antes de aplicar 087.', v_lit;
      END IF;
    END LOOP;
  END IF;
END
$$;

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_type_check CHECK (
    entity_type IN (
      'trip',
      'reservation',
      'reservation_passenger',
      'agency_settings',
      'notification_preferences',
      'reservation_link',
      'payment',
      'checkout_attempt'
    )
  );

COMMENT ON CONSTRAINT audit_log_entity_type_check ON public.audit_log IS
  '065 + 069 (6) + 086 payment (1) + 087 checkout_attempt (1). Aditivo: no quitar valores.';

-- ============================================================
-- 3) Tabla checkout_attempts
-- ============================================================

CREATE TABLE public.checkout_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.agencies(id),
  customer_id UUID NOT NULL REFERENCES public.users(id),
  seat_ids UUID[] NOT NULL CHECK (cardinality(seat_ids) > 0),
  passenger_data JSONB NOT NULL CHECK (jsonb_typeof(passenger_data) = 'array'),
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN (
      'created',         -- intento creado, sin comprobante
      'pending_review',  -- comprobante enviado, ventana de 24h abierta
      'rejected',        -- rechazado con reenvio permitido (no terminal)
      'verified',        -- aprobado: reserva + pago creados (terminal)
      'rejected_final',  -- tercer comprobante rechazado (terminal)
      'expired',         -- ventana agotada (terminal)
      'cancelled'        -- cancelado por el cliente (terminal)
    )),
  proof_count INTEGER NOT NULL DEFAULT 0
    CHECK (proof_count >= 0 AND proof_count <= 3),
  proof_path TEXT,
  payment_reference TEXT,
  bank_origin TEXT,
  payment_datetime TIMESTAMPTZ,
  proof_submitted_at TIMESTAMPTZ,
  review_started_at TIMESTAMPTZ,
  rejection_reason TEXT,
  rejection_count INTEGER NOT NULL DEFAULT 0 CHECK (rejection_count >= 0),
  history JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(history) = 'array'),
  idempotency_key TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES public.users(id),
  CONSTRAINT checkout_attempts_verified_fields_check CHECK (
    (status = 'verified' AND verified_at IS NOT NULL)
    OR status <> 'verified'
  ),
  CONSTRAINT checkout_attempts_bank_origin_check CHECK (
    bank_origin IS NULL OR char_length(bank_origin) <= 120
  ),
  CONSTRAINT checkout_attempts_payment_reference_check CHECK (
    payment_reference IS NULL OR char_length(payment_reference) <= 100
  ),
  CONSTRAINT checkout_attempts_review_window_check CHECK (
    status <> 'pending_review' OR review_started_at IS NOT NULL
  )
);

CREATE INDEX idx_checkout_attempts_status_expires
  ON public.checkout_attempts (status, expires_at);
CREATE INDEX idx_checkout_attempts_agency_status
  ON public.checkout_attempts (agency_id, status, created_at DESC);
CREATE INDEX idx_checkout_attempts_customer
  ON public.checkout_attempts (customer_id, created_at DESC);

COMMENT ON TABLE public.checkout_attempts IS
  'MKT-007: intento de compra marketplace. NO es una reserva. La reserva definitiva, sus pasajeros, el pago verificado y sus allocations solo nacen en verify_checkout_attempt.';
COMMENT ON COLUMN public.checkout_attempts.passenger_data IS
  'Snapshot JSONB de los pasajeros en el MISMO orden que seat_ids. Cada elemento: {seat_id, first_name, last_name, document, phone}.';
COMMENT ON COLUMN public.checkout_attempts.history IS
  'Trazabilidad completa: entradas {kind:submission} por cada comprobante enviado y {kind:review} por cada decision (verified/rejected). Se conserva entre rechazos y reenvios.';
COMMENT ON COLUMN public.checkout_attempts.expires_at IS
  'Unica fecha limite del intento. Se fija al crear (TTL restante de los locks, 900 s) y se re-fija a now()+24h con cada comprobante. Solo el servidor la calcula.';

ALTER TABLE public.checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.checkout_attempts FROM anon;
REVOKE ALL ON TABLE public.checkout_attempts FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.checkout_attempts TO service_role;

CREATE TRIGGER checkout_attempts_updated_t
  BEFORE UPDATE ON public.checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 4) Ownership de los locks: relacion explicita entre un seat y el
--    intento que lo reclamo. Sin esta columna no es posible probar
--    de forma segura "este lock pertenece a ESTE intento".
-- ============================================================

ALTER TABLE public.seats
  ADD COLUMN IF NOT EXISTS checkout_attempt_id UUID
  REFERENCES public.checkout_attempts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_seats_checkout_attempt_id
  ON public.seats (checkout_attempt_id)
  WHERE checkout_attempt_id IS NOT NULL;

-- Limpieza defensiva: el vinculo solo es valido mientras el asiento
-- esta 'locked'. Cualquier transicion de estado (verify, cleanup
-- periodico del backend, edge function release-expired-locks,
-- cancelacion interna de tour) deja checkout_attempt_id en NULL y
-- evita referencias huerfanas a intentos cerrados.
CREATE OR REPLACE FUNCTION public.seats_clear_checkout_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'locked'
     AND OLD.checkout_attempt_id IS NOT NULL THEN
    NEW.checkout_attempt_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seats_clear_checkout_attempt ON public.seats;
CREATE TRIGGER trg_seats_clear_checkout_attempt
  BEFORE UPDATE ON public.seats
  FOR EACH ROW
  EXECUTE FUNCTION public.seats_clear_checkout_attempt();

-- ============================================================
-- 5) create_checkout_attempt
--    Crea el intento y estampa seats.checkout_attempt_id en la MISMA
--    transaccion. NO crea reservations, NO crea payments.
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

-- ============================================================
-- 6) submit_checkout_proof
--    Primer envio o reenvio de comprobante. Abre la ventana de 24 h,
--    incrementa el contador de forma atomica y protege los locks hasta
--    el nuevo vencimiento. NO crea payments ni reservations.
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_checkout_proof(
  p_attempt_id UUID,
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
  v_attempt public.checkout_attempts%ROWTYPE;
  v_key_ns TEXT;
  v_path_prefix TEXT;
  v_path_rest TEXT;
  v_ref TEXT;
  v_bank TEXT;
  v_seat RECORD;
  v_found_seats INTEGER := 0;
  v_rowcount BIGINT;
  v_seq INTEGER;
  v_entry JSONB;
  v_dup JSONB;
  v_new_expires TIMESTAMPTZ;
BEGIN
  -- 1) Entrada. La ruta la compone el backend como
  --    <attempt_id>/<sha256>.<ext>.
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CUSTOMER_REQUIRED: An authenticated customer is required';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_INPUT: p_idempotency_key is required';
  END IF;
  IF p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ATTEMPT_NOT_FOUND: Checkout attempt not found';
  END IF;

  v_path_prefix := p_attempt_id::text || '/';
  IF p_proof_path IS NULL
     OR length(p_proof_path) > 512
     OR left(p_proof_path, length(v_path_prefix)) <> v_path_prefix THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_INPUT: p_proof_path must live inside the attempt directory';
  END IF;

  v_path_rest := substr(p_proof_path, length(v_path_prefix) + 1);
  IF v_path_rest = ''
     OR v_path_rest LIKE '%..%'
     OR v_path_rest LIKE '%/%'
     OR v_path_rest !~ '\.(png|jpg|jpeg|webp|pdf)$' THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_INPUT: p_proof_path has an invalid proof filename';
  END IF;

  -- 2) Datos de conciliacion: los tres campos son obligatorios.
  --    NULLIF + btrim convierte la cadena vacia en NULL para que el
  --    CHECK de la tabla tampoco la acepte.
  v_ref := NULLIF(btrim(COALESCE(p_payment_reference, '')), '');
  v_bank := NULLIF(btrim(COALESCE(p_bank_origin, '')), '');

  IF v_ref IS NULL OR length(v_ref) > 100 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_RECONCILIATION: payment_reference is required (max 100 chars)';
  END IF;
  IF v_bank IS NULL OR length(v_bank) > 120 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_RECONCILIATION: bank_origin is required (max 120 chars)';
  END IF;
  IF p_payment_datetime IS NULL THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_RECONCILIATION: payment_datetime is required';
  END IF;
  IF p_payment_datetime > NOW() + interval '5 minutes' THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_RECONCILIATION: payment_datetime cannot be in the future';
  END IF;

  -- 3) Intento con lock de fila: serializa envios concurrentes,
  --    verificacion, rechazo y cleanup.
  SELECT ca.*
    INTO v_attempt
  FROM public.checkout_attempts ca
  WHERE ca.id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ATTEMPT_NOT_FOUND: Checkout attempt not found';
  END IF;

  IF v_attempt.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_NOT_OWNER: The checkout attempt does not belong to this customer';
  END IF;

  -- 4) Idempotencia: se busca la clave dentro del historial. La misma
  --    clave con la MISMA ruta devuelve el resultado existente sin
  --    escritura; con otra ruta es un conflicto estable.
  v_key_ns := 'mkt007:' || p_attempt_id::text || ':' || p_idempotency_key::text;

  SELECT e INTO v_dup
  FROM jsonb_array_elements(v_attempt.history) AS e
  WHERE e->>'kind' = 'submission'
    AND e->>'idempotency_key' = v_key_ns
  LIMIT 1;

  IF FOUND THEN
    IF v_dup->>'proof_path' IS DISTINCT FROM p_proof_path
       OR v_dup->>'payment_reference' IS DISTINCT FROM v_ref
       OR v_dup->>'bank_origin' IS DISTINCT FROM v_bank THEN
      RAISE EXCEPTION 'ERR_CHECKOUT_IDEMPOTENCY_CONFLICT: Idempotency key reused with a different submission';
    END IF;

    RETURN jsonb_build_object(
      'attempt_id', v_attempt.id,
      'status', v_attempt.status,
      'proof_count', v_attempt.proof_count,
      'proof_path', v_attempt.proof_path,
      'amount_cents', v_attempt.amount_cents,
      'expires_at', v_attempt.expires_at,
      'idempotent', true
    );
  END IF;

  -- 5) Estado. Terminal => cerrado; pending_review => ya hay un
  --    comprobante esperando; created|rejected => reenvio permitido.
  IF v_attempt.status IN ('verified', 'rejected_final', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ATTEMPT_CLOSED: Checkout attempt is in status %', v_attempt.status;
  END IF;

  IF v_attempt.status = 'pending_review' THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_PROOF_PENDING: A proof is already waiting for review';
  END IF;

  IF v_attempt.expires_at <= NOW() THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_WINDOW_EXPIRED: The checkout window has expired';
  END IF;

  IF v_attempt.proof_count >= 3 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_PROOF_LIMIT: Only three proofs are allowed per checkout attempt';
  END IF;

  -- 6) Los locks siguen siendo del intento y siguen vigentes.
  FOR v_seat IN
    SELECT s.id, s.seat_code, s.trip_id, s.status, s.locked_by, s.guest_session_id,
           s.lock_expires_at, s.checkout_attempt_id
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
      RAISE EXCEPTION 'ERR_CHECKOUT_LOCK_EXPIRED: Seat % is no longer locked by this checkout attempt', v_seat.seat_code;
    END IF;

    IF v_seat.lock_expires_at IS NULL OR v_seat.lock_expires_at <= NOW() THEN
      RAISE EXCEPTION 'ERR_CHECKOUT_LOCK_EXPIRED: Seat % lock expired', v_seat.seat_code;
    END IF;
  END LOOP;

  IF v_found_seats <> cardinality(v_attempt.seat_ids) THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_LOCK_EXPIRED: One or more attempt seats could not be locked';
  END IF;

  -- 7) Nueva ventana: 24 h contadas DESDE este envio. Los locks se
  --    prolongan a la par; nadie mas puede reclamarlos.
  v_new_expires := NOW() + interval '24 hours';
  v_seq := v_attempt.proof_count + 1;

  v_entry := jsonb_build_object(
    'kind', 'submission',
    'seq', v_seq,
    'proof_path', p_proof_path,
    'payment_reference', v_ref,
    'bank_origin', v_bank,
    'payment_datetime', p_payment_datetime,
    'submitted_at', NOW(),
    'idempotency_key', v_key_ns
  );

  UPDATE public.checkout_attempts ca
  SET status = 'pending_review',
      proof_count = v_seq,
      proof_path = p_proof_path,
      payment_reference = v_ref,
      bank_origin = v_bank,
      payment_datetime = p_payment_datetime,
      proof_submitted_at = NOW(),
      review_started_at = NOW(),
      rejection_reason = NULL,
      expires_at = v_new_expires,
      history = ca.history || jsonb_build_array(v_entry)
  WHERE ca.id = p_attempt_id;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ATTEMPT_NOT_FOUND: Checkout attempt not found';
  END IF;

  UPDATE public.seats s
  SET lock_expires_at = v_new_expires
  WHERE s.id = ANY(v_attempt.seat_ids)
    AND s.status = 'locked'
    AND s.checkout_attempt_id = p_attempt_id;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount <> cardinality(v_attempt.seat_ids) THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_LOCK_EXPIRED: Seat state changed during proof submission';
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', p_attempt_id,
    'status', 'pending_review',
    'proof_count', v_seq,
    'remaining_submissions', 3 - v_seq,
    'proof_path', p_proof_path,
    'payment_reference', v_ref,
    'bank_origin', v_bank,
    'payment_datetime', p_payment_datetime,
    'amount_cents', v_attempt.amount_cents,
    'expires_at', v_new_expires,
    'idempotent', false
  );
END;
$$;

COMMENT ON FUNCTION public.submit_checkout_proof(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) IS
  'MKT-007: recibe un comprobante (primer envio o reenvio) de un checkout_attempt. En UNA transaccion valida dueno, estado, ventana y locks del intento, exige los tres datos de conciliacion, incrementa proof_count de forma atomica (max 3), abre una ventana de 24 h y prolonga seats.lock_expires_at hasta ese instante. NO crea payments ni reservations. La validacion de los BYTES del archivo ocurre en el backend, no aqui. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.submit_checkout_proof(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_checkout_proof(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.submit_checkout_proof(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_checkout_proof(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- ============================================================
-- 7) verify_checkout_attempt
--    Aprobacion ATOMICA: nace la reserva definitiva, sus pasajeros,
--    el pago VERIFICADO, sus allocations, la transicion definitiva de
--    los asientos, la auditoria y el outbox (082 emite
--    reservation.created en el INSERT).
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

    RETURN jsonb_build_object(
      'attempt_id', v_attempt.id,
      'status', 'verified',
      'already_verified', true,
      'reservation_id', v_reservation_id,
      'payment_id', v_payment_id,
      'amount_cents', v_attempt.amount_cents,
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

  -- 4) Viaje sigue activo.
  SELECT t.status, r.destination
    INTO v_trip_status, v_destination
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

  v_expected_amount := v_attempt.unit_price * v_pax_count;

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
    'fully_paid'
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
      amount_cents, currency, status, proof_url,
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

  -- 11) Una allocation por pasajero activo con su unit_price exacto.
  INSERT INTO public.payment_allocations (
    payment_id, reservation_id, reservation_passenger_id, amount_cents
  )
  SELECT v_payment_id, v_reservation_id, rp.id, rp.unit_price
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
    'proof_count', v_attempt.proof_count,
    'allocation_count', v_pax_count,
    'passenger_count', v_pax_count,
    'verified_at', NOW(),
    'verified_by', p_actor_user_id,
    'payment_status', 'fully_paid',
    'audit_id', v_audit_id,
    'reservation_audit_id', v_reservation_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.verify_checkout_attempt(UUID, UUID) IS
  'MKT-007: aprobacion ATOMICA de un checkout_attempt. En UNA transaccion valida estado pending_review + ventana vigente + actor agency con ownership, bloquea los seats del intento, comprueba pasajeros 1:1 y monto contra el snapshot, y crea reservations (status=reserved, source=marketplace, payment_status=fully_paid) + reservation_passengers + payments (status=verified con external_reference/bank_origin/payment_datetime) + payment_allocations, transiciona los seats a reserved, cierra el intento y escribe la auditoria. 082 emite reservation.created en el INSERT. Idempotente sobre status=verified. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.verify_checkout_attempt(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_checkout_attempt(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.verify_checkout_attempt(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_checkout_attempt(UUID, UUID) TO service_role;

-- ============================================================
-- 8) reject_checkout_attempt
--    Rechazo con reenvio permitido (status='rejected') o rechazo
--    final (status='rejected_final' + liberacion de locks propios).
-- ============================================================

CREATE OR REPLACE FUNCTION public.reject_checkout_attempt(
  p_attempt_id UUID,
  p_actor_user_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_actor public.users%ROWTYPE;
  v_reason TEXT;
  v_final BOOLEAN := false;
  v_rowcount BIGINT;
  v_freed INTEGER := 0;
  v_audit_id UUID;
  v_remaining INTEGER;
BEGIN
  v_reason := btrim(COALESCE(p_reason, ''));

  IF length(v_reason) = 0 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_REJECT_REASON: reason must be 1-500 characters';
  END IF;

  -- 1) Intento con lock de fila.
  SELECT ca.* INTO v_attempt
  FROM public.checkout_attempts ca
  WHERE ca.id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ATTEMPT_NOT_FOUND: Checkout attempt not found';
  END IF;

  -- 2) Autorizacion agency con ownership.
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

  -- 3) Idempotencia por estado.
  IF v_attempt.status = 'rejected' THEN
    RETURN jsonb_build_object(
      'attempt_id', v_attempt.id,
      'status', 'rejected',
      'already_rejected', true,
      'final', false,
      'proof_count', v_attempt.proof_count,
      'remaining_submissions', GREATEST(3 - v_attempt.proof_count, 0),
      'rejection_reason', v_attempt.rejection_reason,
      'freed_seats', 0
    );
  END IF;

  IF v_attempt.status = 'rejected_final' THEN
    RETURN jsonb_build_object(
      'attempt_id', v_attempt.id,
      'status', 'rejected_final',
      'already_rejected', true,
      'final', true,
      'proof_count', v_attempt.proof_count,
      'remaining_submissions', 0,
      'rejection_reason', v_attempt.rejection_reason,
      'freed_seats', 0
    );
  END IF;

  IF v_attempt.status = 'verified' THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ALREADY_VERIFIED: An approved checkout cannot be rejected';
  END IF;

  IF v_attempt.status IN ('expired', 'cancelled') THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ATTEMPT_CLOSED: Checkout attempt is in status %', v_attempt.status;
  END IF;

  IF v_attempt.status = 'created' THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_NO_PROOF: There is no submitted proof to reject';
  END IF;

  IF v_attempt.status IS DISTINCT FROM 'pending_review' THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_NOT_PENDING: Checkout attempt is in status %', v_attempt.status;
  END IF;

  -- 4) La ventana la cierra el cleanup, no el rechazo. Si ya vencio
  --    el resultado correcto es 'expired'.
  IF v_attempt.expires_at <= NOW() THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_WINDOW_EXPIRED: The review window has expired';
  END IF;

  v_remaining := GREATEST(3 - v_attempt.proof_count, 0);

  -- 5) Tercer comprobante rechazado => rechazo final y liberacion de
  --    los locks propios. Con reenvios pendientes se conservan.
  IF v_attempt.proof_count >= 3 THEN
    v_final := true;
  END IF;

  IF v_final THEN
    UPDATE public.seats s
    SET status = 'available',
        locked_by = NULL,
        locked_at = NULL,
        lock_expires_at = NULL,
        guest_session_id = NULL,
        checkout_attempt_id = NULL
    WHERE s.checkout_attempt_id = p_attempt_id
      AND s.status = 'locked';

    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    v_freed := v_rowcount;
  END IF;

  UPDATE public.checkout_attempts ca
  SET status = CASE WHEN v_final THEN 'rejected_final' ELSE 'rejected' END,
      rejection_reason = v_reason,
      rejection_count = ca.rejection_count + 1,
      closed_at = CASE WHEN v_final THEN NOW() ELSE ca.closed_at END,
      history = ca.history || jsonb_build_array(jsonb_build_object(
        'kind', 'review',
        'decision', 'rejected',
        'final', v_final,
        'reason', v_reason,
        'seq', v_attempt.proof_count,
        'at', NOW(),
        'actor_user_id', p_actor_user_id
      ))
  WHERE ca.id = p_attempt_id;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_RACE: Checkout attempt changed during rejection';
  END IF;

  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    v_attempt.agency_id,
    'checkout.rejected',
    'checkout_attempt',
    p_attempt_id,
    jsonb_build_object('status', 'pending_review', 'proof_count', v_attempt.proof_count),
    jsonb_build_object('status', CASE WHEN v_final THEN 'rejected_final' ELSE 'rejected' END),
    jsonb_build_object(
      'reason', v_reason,
      'final', v_final,
      'proof_count', v_attempt.proof_count,
      'remaining_submissions', v_remaining,
      'freed_seats', v_freed
    )
  );

  RETURN jsonb_build_object(
    'attempt_id', p_attempt_id,
    'status', CASE WHEN v_final THEN 'rejected_final' ELSE 'rejected' END,
    'already_rejected', false,
    'final', v_final,
    'proof_count', v_attempt.proof_count,
    'remaining_submissions', v_remaining,
    'rejection_reason', v_reason,
    'freed_seats', v_freed,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) IS
  'MKT-007: rechaza el comprobante de un checkout_attempt. Con proof_count < 3 pasa a status=rejected (reenvio permitido, locks conservados, SIN abrir ventana nueva: la nueva ventana se abre solo con el siguiente envio). Con proof_count = 3 pasa a rejected_final y libera UNICAMENTE los seats con checkout_attempt_id = este intento. Idempotente sobre rejected/rejected_final. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) TO service_role;

-- ============================================================
-- 9) cancel_checkout_attempt
--    Cancelacion voluntaria por el propio cliente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_checkout_attempt(
  p_attempt_id UUID,
  p_customer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_rowcount BIGINT;
  v_freed INTEGER := 0;
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CUSTOMER_REQUIRED: An authenticated customer is required';
  END IF;

  SELECT ca.* INTO v_attempt
  FROM public.checkout_attempts ca
  WHERE ca.id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ATTEMPT_NOT_FOUND: Checkout attempt not found';
  END IF;

  IF v_attempt.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_NOT_OWNER: The checkout attempt does not belong to this customer';
  END IF;

  IF v_attempt.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'attempt_id', v_attempt.id,
      'status', 'cancelled',
      'already_cancelled', true,
      'freed_seats', 0
    );
  END IF;

  IF v_attempt.status = 'verified' THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ALREADY_VERIFIED: An approved checkout cannot be cancelled';
  END IF;

  IF v_attempt.status IN ('rejected_final', 'expired') THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ATTEMPT_CLOSED: Checkout attempt is in status %', v_attempt.status;
  END IF;

  -- Solo se liberan locks todavia pertenecientes a ESTE intento.
  UPDATE public.seats s
  SET status = 'available',
      locked_by = NULL,
      locked_at = NULL,
      lock_expires_at = NULL,
      guest_session_id = NULL,
      checkout_attempt_id = NULL
  WHERE s.checkout_attempt_id = p_attempt_id
    AND s.status = 'locked';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  v_freed := v_rowcount;

  UPDATE public.checkout_attempts ca
  SET status = 'cancelled',
      closed_at = NOW(),
      history = ca.history || jsonb_build_array(jsonb_build_object(
        'kind', 'review',
        'decision', 'cancelled',
        'at', NOW(),
        'actor_user_id', p_customer_id
      ))
  WHERE ca.id = p_attempt_id
    AND ca.status IN ('created', 'pending_review', 'rejected');

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_RACE: Checkout attempt changed during cancellation';
  END IF;

  -- INSERT directo: audit_append() de 065 rechaza actor_role
  -- 'customer' en su guard interno (mismo motivo que 079).
  INSERT INTO public.audit_log (
    actor_user_id, actor_role, agency_id, action, entity_type,
    entity_id, before, after, metadata
  ) VALUES (
    p_customer_id,
    'customer',
    v_attempt.agency_id,
    'checkout.cancelled',
    'checkout_attempt',
    p_attempt_id,
    jsonb_build_object('status', v_attempt.status),
    jsonb_build_object('status', 'cancelled'),
    jsonb_build_object('freed_seats', v_freed, 'trigger', 'mkt007_cancel')
  );

  RETURN jsonb_build_object(
    'attempt_id', p_attempt_id,
    'status', 'cancelled',
    'already_cancelled', false,
    'freed_seats', v_freed
  );
END;
$$;

COMMENT ON FUNCTION public.cancel_checkout_attempt(UUID, UUID) IS
  'MKT-007: cancelacion voluntaria del cliente sobre un intento no terminal. Libera solo los seats con checkout_attempt_id = este intento y deja constancia en history + audit_log (INSERT directo porque audit_append rechaza actor customer). SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.cancel_checkout_attempt(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_checkout_attempt(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_checkout_attempt(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_checkout_attempt(UUID, UUID) TO service_role;

-- ============================================================
-- 10) cleanup_expired_checkout_attempts
--     Idempotente, acotado (200 por llamada) y deadlock-safe. Usa
--     FOR UPDATE SKIP LOCKED: si una aprobacion esta en vuelo sobre
--     el mismo intento se salta esa fila; si la aprobacion aborta,
--     la siguiente llamada la procesa.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_checkout_attempts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_rowcount BIGINT;
  v_expired INTEGER := 0;
  v_freed INTEGER := 0;
  v_freed_total INTEGER := 0;
  v_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  FOR v_attempt IN
    SELECT ca.*
    FROM public.checkout_attempts ca
    WHERE ca.status IN ('created', 'pending_review', 'rejected')
      AND ca.expires_at <= NOW()
    ORDER BY ca.expires_at
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  LOOP
    -- 1) Solo locks que todavia pertenecen a este intento.
    UPDATE public.seats s
    SET status = 'available',
        locked_by = NULL,
        locked_at = NULL,
        lock_expires_at = NULL,
        guest_session_id = NULL,
        checkout_attempt_id = NULL
    WHERE s.checkout_attempt_id = v_attempt.id
      AND s.status = 'locked';

    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    v_freed := v_rowcount;

    -- 2) Cierre idempotente: el WHERE repite las condiciones de
    --    seleccion, asi que una carrera contra verify/reject/cancel
    --    deja 0 filas y no contabiliza nada.
    UPDATE public.checkout_attempts ca
    SET status = 'expired',
        closed_at = NOW(),
        history = ca.history || jsonb_build_array(jsonb_build_object(
          'kind', 'review',
          'decision', 'expired',
          'at', NOW(),
          'freed_seats', v_freed
        ))
    WHERE ca.id = v_attempt.id
      AND ca.status IN ('created', 'pending_review', 'rejected');

    GET DIAGNOSTICS v_rowcount = ROW_COUNT;

    IF v_rowcount = 1 THEN
      v_expired := v_expired + 1;
      v_freed_total := v_freed_total + v_freed;
      v_ids := v_ids || v_attempt.id;

      -- Actor system: audit_append admite (NULL, 'system').
      PERFORM public.audit_append(
        NULL,
        'system',
        v_attempt.agency_id,
        'checkout.expired',
        'checkout_attempt',
        v_attempt.id,
        jsonb_build_object('status', v_attempt.status, 'expires_at', v_attempt.expires_at),
        jsonb_build_object('status', 'expired'),
        jsonb_build_object('freed_seats', v_freed, 'trigger', 'mkt007_cleanup')
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'expired', v_expired,
    'freed_seats', v_freed_total,
    'attempt_ids', to_jsonb(v_ids)
  );
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_checkout_attempts() IS
  'MKT-007: cierra los intentos vencidos (created/pending_review/rejected con expires_at <= now) y libera SOLO los seats con checkout_attempt_id = cada intento y status=locked. FOR UPDATE SKIP LOCKED: no puede invalidar una aprobacion que ya gano la carrera transaccional. Idempotente; lotes de 200. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.cleanup_expired_checkout_attempts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_checkout_attempts() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_expired_checkout_attempts() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_checkout_attempts() TO service_role;

-- ============================================================
-- 11) Cierre de los caminos legacy que permitian saltarse la
--     revision. MKT-007 exige que la reserva definitiva nazca solo
--     en verify_checkout_attempt.
--
--     - 081 create_marketplace_reservation creaba la reserva ANTES
--       del comprobante.
--     - 083 submit_marketplace_payment creaba un pago 'pending' y
--       promovia reservations locked->reserved sin aprobacion.
--
--     Se REVOCA EXECUTE a service_role: es el unico rol que puede
--     invocarlas desde los backends. Las funciones NO se eliminan
--     (081/083 son historicas y sus tests de contrato leen su
--     texto), pero dejan de ser invocables.
--
--     085 verify/reject_marketplace_payment SE CONSERVA ejecutable:
--     sigue siendo la via de revision de pagos pendientes creados por
--     el flujo anterior y del backend admin de Tour. Con el flujo
--     nuevo no existe ningun bypass: los pagos nacen 'verified' y no
--     hay forma de crear un pago 'pending' sin 083.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.create_marketplace_reservation(UUID, UUID, UUID, UUID[], TEXT[], TEXT[], TEXT[]) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.submit_marketplace_payment(UUID, UUID, UUID, TEXT) FROM service_role;

COMMENT ON FUNCTION public.create_marketplace_reservation(UUID, UUID, UUID, UUID[], TEXT[], TEXT[], TEXT[]) IS
  'MKT-004/MKT-005 (OBSOLETO desde MKT-007): creaba la reserva ANTES de la revision del comprobante. EXECUTE revocado a service_role en 087. Usar create_checkout_attempt + verify_checkout_attempt.';

COMMENT ON FUNCTION public.submit_marketplace_payment(UUID, UUID, UUID, TEXT) IS
  'MKT-005 (OBSOLETO desde MKT-007): creaba un pago pending y promovia reservations locked->reserved sin aprobacion. EXECUTE revocado a service_role en 087. Usar submit_checkout_proof + verify_checkout_attempt.';
