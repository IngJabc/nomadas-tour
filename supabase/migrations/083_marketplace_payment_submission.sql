-- ============================================================
-- 083_marketplace_payment_submission.sql
-- MKT-005 Fase 1 — envio de comprobante de pago marketplace:
-- bucket privado payment-proofs + RPC transaccional
-- submit_marketplace_payment.
--
-- Contexto:
--   081 crea la reserva en status='locked' con los seats bloqueados
--     por el customer (locked_by) y el TTL original intacto
--     (lock_expires_at, 900s marketplace).
--   082 emite reservation.created SOLO en la promocion
--     locked -> reserved (trg_reservations_outbox_created_on_promotion).
--   076 define payments: idempotency_key UNIQUE, amount_cents > 0,
--     provider 'manual', currency 'COP', status 'pending',
--     proof_url como ruta interna (nunca una URL firmada).
--   042 es el patron de bucket; aqui el MISMO INSERT con public=false.
--
-- Reglas de la Fase 1 (docs/business-rules.md secciones 10 y 11):
--   - UN bucket nuevo y PRIVADO: payment-proofs. Los comprobantes se
--     suben con service_role desde el backend (Fase 2). NO se crean
--     policies de escritura para anon/authenticated en el almacenamiento.
--   - submit_marketplace_payment corre en UNA sola transaccion:
--     valida, inserta el pago pending, promueve reservations
--     locked -> reserved (el trigger de 082 emite UNA sola vez
--     reservation.created) y convierte los seats locked -> reserved
--     limpiando los campos de lock.
--   - Idempotencia con namespace server-side:
--       mkt005:<reservation_id>:<idempotency_key>
--     misma clave + misma prueba -> devuelve el pago existente sin
--     escribir nada; misma clave + otra prueba -> conflicto, sin
--     mutacion. La clave nunca viaja cruda a la columna unique.
--   - El monto NUNCA llega del cliente: se calcula aqui con
--     SUM(reservation_passengers.unit_price) sobre los pasajeros
--     activos. Moneda fija COP, provider 'manual'.
--   - El plazo sigue siendo el lock original: si lock_expires_at ya
--     vencio, el envio se rechaza (ERR_PAYMENT_LOCK_EXPIRED).
--     Esta RPC NO extiende TTLs ni modifica lock_expires_at a futuro.
--   - El pago queda 'pending': la verificacion y la creacion de
--     allocations son Fase 3 (MKT-006). Aqui NO se escribe en la
--     tabla de asignaciones de 076 ni se toca
--     reservations.payment_status.
--
-- Orden de validacion y escritura (contract para la Fase 2):
--   1) customer, clave de idempotencia y ruta del comprobante
--   2) reservations FOR UPDATE -> dueno -> source='marketplace'
--   3) resolver idempotencia ANTES de rechazar "ya enviada"
--   4) operacion nueva unicamente sobre status='locked'
--   5) pasajeros activos (FOR UPDATE) -> seats (FOR UPDATE, ordenado)
--   6) monto = SQL SUM(unit_price); cero pasajeros o monto <= 0
--      se rechazan antes de escribir
--   7) INSERT payments -> UPDATE reservations -> UPDATE seats,
--      cada escritura con ROW_COUNT verificado: cualquier
--      discrepancia lanza excepcion y revierte TODO.
--
-- Nota de validacion: las pruebas de este repo son ESTATICAS sobre el
-- texto de esta migracion. No ejecutan PostgreSQL y por tanto NO
-- demuestran atomicidad, aislamiento ni comportamiento de triggers;
-- eso se verifica contra una BD real en Fase 2/3.
--
-- Migracion marketplace (074-083). Requiere 075, 076, 080, 081 y 082.
-- NO se toca: 074-082, RPCs de tour, asignaciones de 076, TTLs,
-- triggers de outbox, CHECK de seats, policies existentes.
--
-- Dry-run:   BEGIN;  \i 083_marketplace_payment_submission.sql   ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) Bucket privado payment-proofs
--    Mismo patron que 042 (agency-assets) con public=false y
--    limite de 5 MB. Escrituras exclusivas del backend con
--    service_role: por eso NO se crea ninguna policy de
--    almacenamiento para anon/authenticated (ni lectura: el
--    comprobante es sensible y el backend lo sirve si hace falta).
-- ============================================================

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 2) submit_marketplace_payment
--    SECURITY DEFINER + EXECUTE solo service_role: el backend es
--    quien traduce el resultado y los errores ERR_PAYMENT_* a la
--    API HTTP. Los mensajes no filtran detalles internos de SQL.
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_marketplace_payment(
  p_reservation_id UUID,
  p_customer_id UUID,
  p_idempotency_key UUID,
  p_proof_path TEXT
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
  v_seat RECORD;
  v_seat_ids UUID[] := ARRAY[]::UUID[];
  v_locked_pax INTEGER := 0;
  v_passenger_count INTEGER := 0;
  v_distinct_seats INTEGER := 0;
  v_priced_count INTEGER := 0;
  v_found_seats INTEGER := 0;
  v_amount INTEGER := 0;
  v_payment_id UUID;
  v_submitted_at TIMESTAMPTZ;
  v_rowcount BIGINT;
  v_constraint TEXT;
BEGIN
  -- ── 1) Entrada: customer, clave y ruta ─────────────────────
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CUSTOMER_REQUIRED: An authenticated customer is required';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_INPUT: p_idempotency_key is required';
  END IF;

  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_RESERVATION_NOT_FOUND: Reservation not found';
  END IF;

  -- La ruta la compone el backend (Fase 2) como
  -- <reservation_id>/<sha256>.<ext>. Aqui se exige que quede
  -- DENTRO del directorio de la reserva: prefijo exacto, sin
  -- '..', sin subcarpetas y solo extensiones de comprobante.
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

  -- ── 2) Reserva con lock de fila. Orden deadlock-safe de 046:
  --       reservations -> passengers -> seats (igual que 079). ─
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

  -- Reservas internal (tour) no existen para este flujo: se responde
  -- "no encontrada" para no revelar reservas ajenas al marketplace.
  IF v_reservation.source IS DISTINCT FROM 'marketplace' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_RESERVATION_NOT_FOUND: Reservation not found';
  END IF;

  -- ── 3) Idempotencia ANTES de mirar el status: un reintento con
  --       la misma clave debe devolver el pago existente aunque
  --       la reserva ya este 'reserved'. ──────────────────────
  v_namespace := 'mkt005:' || p_reservation_id::text || ':' || p_idempotency_key::text;

  SELECT p.*
    INTO v_existing
  FROM public.payments p
  WHERE p.idempotency_key = v_namespace;

  IF FOUND THEN
    -- Misma clave con otro comprobante o de otra submission:
    -- conflicto estable, sin ninguna escritura.
    IF v_existing.proof_url IS DISTINCT FROM p_proof_path
       OR v_existing.reservation_id IS DISTINCT FROM p_reservation_id
       OR v_existing.customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'ERR_PAYMENT_IDEMPOTENCY_CONFLICT: Idempotency key reused with a different submission';
    END IF;

    RETURN jsonb_build_object(
      'payment_id', v_existing.id,
      'reservation_id', v_existing.reservation_id,
      'status', v_reservation.status,
      'amount_cents', v_existing.amount_cents,
      'currency', v_existing.currency,
      'proof_url', v_existing.proof_url,
      'submitted_at', v_existing.submitted_at,
      'idempotent', true
    );
  END IF;

  -- ── 4) Status: una operacion nueva solo sobre 'locked'. ─────
  --       reservada/confirmada -> ya hay comprobante (o es tour);
  --       cancelada/completada/abordada -> reserva cerrada. ────
  IF v_reservation.status <> 'locked' THEN
    IF v_reservation.status IN ('cancelled', 'completed', 'boarded') THEN
      RAISE EXCEPTION 'ERR_PAYMENT_RESERVATION_CLOSED: Reservation is in status %', v_reservation.status;
    END IF;
    RAISE EXCEPTION 'ERR_PAYMENT_ALREADY_SUBMITTED: Reservation is in status %', v_reservation.status;
  END IF;

  -- ── 5) Pasajeros activos con sus plazas, en orden estable. ──
  FOR v_pax IN
    SELECT rp.seat_id
    FROM public.reservation_passengers rp
    WHERE rp.reservation_id = p_reservation_id
      AND rp.status = 'active'
    ORDER BY rp.seat_id
    FOR UPDATE
  LOOP
    v_locked_pax := v_locked_pax + 1;
    v_seat_ids := v_seat_ids || v_pax.seat_id;
  END LOOP;

  -- ── 6) Seats: bloqueados por ESTE customer, del viaje de la
  --       reserva, sin ownership guest residual y con TTL
  --       vigente. Se toman FOR UPDATE para serializar contra
  --       cleanup/cancelacion concurrentes. ───────────────────
  FOR v_seat IN
    SELECT s.id, s.seat_code, s.trip_id, s.status, s.locked_by,
           s.guest_session_id, s.lock_expires_at
    FROM public.seats s
    WHERE s.id = ANY(v_seat_ids)
    ORDER BY s.id
    FOR UPDATE
  LOOP
    v_found_seats := v_found_seats + 1;

    IF v_seat.trip_id IS DISTINCT FROM v_reservation.trip_id
       OR v_seat.status IS DISTINCT FROM 'locked'
       OR v_seat.locked_by IS DISTINCT FROM p_customer_id
       OR v_seat.guest_session_id IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_PAYMENT_LOCK_EXPIRED: Seat % is no longer locked by this customer', v_seat.seat_code;
    END IF;

    IF v_seat.lock_expires_at IS NULL OR v_seat.lock_expires_at <= NOW() THEN
      RAISE EXCEPTION 'ERR_PAYMENT_LOCK_EXPIRED: Seat % lock expired', v_seat.seat_code;
    END IF;
  END LOOP;

  -- ── 7) Plazas vs pasajeros y monto: SUM SQL puro del
  --       snapshot unit_price. Cero pasajeros, plazas que no
  --       coinciden 1:1, precios faltantes o monto no positivo
  --       se rechazan ANTES de cualquier escritura. ────────────
  SELECT COUNT(*),
         COUNT(DISTINCT rp.seat_id),
         COUNT(rp.unit_price),
         COALESCE(SUM(rp.unit_price), 0)
    INTO v_passenger_count, v_distinct_seats, v_priced_count, v_amount
  FROM public.reservation_passengers rp
  WHERE rp.reservation_id = p_reservation_id
    AND rp.status = 'active';

  IF v_locked_pax <> v_passenger_count THEN
    RAISE EXCEPTION 'ERR_PAYMENT_AMOUNT_INVALID: Active passenger set changed during submission';
  END IF;

  IF v_passenger_count = 0 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_AMOUNT_INVALID: Reservation has no active passengers to charge';
  END IF;

  IF v_distinct_seats <> v_passenger_count THEN
    RAISE EXCEPTION 'ERR_PAYMENT_AMOUNT_INVALID: Reservation seats do not match its passengers 1:1';
  END IF;

  IF v_priced_count <> v_passenger_count OR v_amount <= 0 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_AMOUNT_INVALID: Reservation amount must be a positive SUM(unit_price)';
  END IF;

  IF v_found_seats <> v_passenger_count THEN
    RAISE EXCEPTION 'ERR_PAYMENT_LOCK_EXPIRED: One or more reservation seats could not be locked';
  END IF;

  -- ── 8) Pago pendiente: importe, moneda y ruta server-side.
  --       El indice payments.idempotency_key es el backstop: en
  --       condiciones normales la reserva ya esta bloqueada arriba,
  --       asi que dos envios iguales se serializan y el segundo
  --       ni llega aqui (lo resuelve el paso 3). El handler solo
  --       acepta exito idempotente si la fila existente valida
  --       reserva + customer + clave + ruta; cualquier otra
  --       violacion unique se propaga como error real. ────────
  BEGIN
    INSERT INTO public.payments (
      reservation_id,
      agency_id,
      customer_id,
      provider,
      amount_cents,
      currency,
      status,
      proof_url,
      idempotency_key
    )
    VALUES (
      p_reservation_id,
      v_reservation.agency_id,
      p_customer_id,
      'manual',
      v_amount,
      'COP',
      'pending',
      p_proof_path,
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
          'status', v_reservation.status,
          'amount_cents', v_existing.amount_cents,
          'currency', v_existing.currency,
          'proof_url', v_existing.proof_url,
          'submitted_at', v_existing.submitted_at,
          'idempotent', true
        );
      END IF;

      RAISE EXCEPTION 'ERR_PAYMENT_IDEMPOTENCY_CONFLICT: Idempotency key reused with a different submission';
  END;

  -- ── 9) locked -> reserved: el UPDATE dispara UNA sola vez el
  --       trigger de promocion de 082 (reservation.created con
  --       dedup_key). Reservations no tiene updated_at; no se
  --       setea ninguno. El WHERE clava la transicion en el
  --       mismo estado validado arriba. ───────────────────────
  UPDATE public.reservations r
  SET status = 'reserved'
  WHERE r.id = p_reservation_id
    AND r.status = 'locked'
    AND r.source = 'marketplace';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_RESERVATION_CLOSED: Reservation is no longer in status locked';
  END IF;

  -- ── 10) Seats locked -> reserved con la misma limpieza de
  --        lock que 069 (locked_by/locked_at/lock_expires_at)
  --        mas guest_session_id de 080. El cleanup periodico
  --        solo libera status='locked' vencidas: estas plazas
  --        quedan fuera de su alcance. Cualquier fila que no
  --        este 'locked' aqui aborta la transaccion completa
  --        (pago incluido). ──────────────────────────────────
  UPDATE public.seats s
  SET status = 'reserved',
      locked_by = NULL,
      locked_at = NULL,
      lock_expires_at = NULL,
      guest_session_id = NULL,
      updated_at = NOW()
  WHERE s.id = ANY(v_seat_ids)
    AND s.status = 'locked';

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  IF v_rowcount <> v_distinct_seats THEN
    RAISE EXCEPTION 'ERR_PAYMENT_LOCK_EXPIRED: Seat state changed during payment submission';
  END IF;

  -- ── 11) Confirmacion visual para el cliente: la reserva ya
  --        esta 'reserved' y el pago queda 'pending' de
  --        verificacion (Fase 3). ─────────────────────────────
  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'reservation_id', p_reservation_id,
    'status', 'reserved',
    'amount_cents', v_amount,
    'currency', 'COP',
    'proof_url', p_proof_path,
    'submitted_at', v_submitted_at,
    'idempotent', false
  );
END;
$$;

COMMENT ON FUNCTION public.submit_marketplace_payment(UUID, UUID, UUID, TEXT) IS
  'MKT-005 Fase 1: recibe el comprobante de una reserva marketplace. En UNA transaccion valida dueno/source/lock TTL, resuelve idempotencia por namespace mkt005:<reservation>:<key>, inserta payments (pending, COP, SUM(unit_price) server-side), promueve reservations locked->reserved (trigger 082 emite reservation.created una vez) y pasa los seats locked->reserved limpiando lock. No extiende TTLs ni escribe allocations. SECURITY DEFINER; EXECUTE service_role only.';

COMMENT ON COLUMN public.payments.proof_url IS
  'Ruta interna del objeto en el bucket payment-proofs (reservation_id/archivo.ext). Nunca es una URL publica ni firmada.';

-- ── 3) Privilegios (mismo patron que 081/082) ──────────────

REVOKE ALL ON FUNCTION public.submit_marketplace_payment(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_marketplace_payment(UUID, UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.submit_marketplace_payment(UUID, UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_marketplace_payment(UUID, UUID, UUID, TEXT) TO service_role;
