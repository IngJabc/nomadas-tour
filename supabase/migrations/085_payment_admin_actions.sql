-- ============================================================
-- 085_payment_admin_actions.sql
-- MKT-006 Fase 6.1 — verificacion y rechazo administrativos de un
-- comprobante marketplace: verify_marketplace_payment y
-- reject_marketplace_payment.
--
-- Contexto:
--   076 define payments (status pending|verified|rejected,
--     amount_cents>0, idempotency_key UNIQUE, verified_at/verified_by,
--     rejection_reason) y payment_allocations (UNIQUE payment_id +
--     reservation_passenger_id, amount_cents>0). El helper
--     reservation_passenger_balance usa solo allocations de pagos
--     VERIFICADOS.
--   083 submit_marketplace_payment crea UN pago pending por reserva
--     con monto = SUM(unit_price) de los pasajeros activos (100%),
--     promueve reservations locked->reserved y NO escribe allocations.
--     Las allocations se crean AQUI, en la verificacion.
--   079 cancel_reservation_passenger cancela UN pasajero, libera su
--     seat y crea refund si tenia pago verificado. cancel_agency_reservation
--     (065) NO aplica al marketplace (requiere status='confirmed' y
--     actor 'agency'; el marketplace usa 'reserved').
--   065 audit_append exige actor_role en (system|superadmin|agency);
--     el actor aqui es agency (MKT-006 Fase 6.2B: la revision de
--     comprobantes la realizan usuarios de agencia, no superadmin).
--     086 amplia los CHECK de accion y entity_type para admitir
--     payment.verified/payment.rejected y entity_type 'payment'.
--
-- Reglas de negocio (docs/business-rules.md 3, 10, 11):
--   - La verificacion es por payment_id, NUNCA por reservation_id.
--   - Verificar crea UNA allocation por pasajero activo con su
--     unit_price exacto y deja el pago 'verified'. Recalcula
--     reservations.payment_status en la MISMA transaccion.
--   - Rechazar un pago INITIAL (sin otros pagos verified para la
--     reserva) cancela la reserva marketplace 'reserved' de forma
--     atomica: pasajeros activos -> cancelled, seats -> available
--     (limpiando lock metadata) y reservation -> cancelled.
--   - Rechazar un FUTURO abono (existen otros pagos verified) NO
--     cancela la reserva; solo rechaza ese pago y recalcula.
--   - Un pago verified NUNCA puede rechazarse (contradiccion -> error).
--   - Reintentos idempotentes: verify sobre verified -> already_verified
--     (sin allocations ni auditoria duplicadas); reject sobre rejected
--     -> already_rejected (sin efectos duplicados).
--
-- Orden de locks (deadlock-safe, analizado en la auditoria 6.1):
--   payments FOR UPDATE (leaf) -> reservations FOR UPDATE ->
--   reservation_passengers FOR UPDATE (ordenado por seat_id) ->
--   seats (solo en el camino de cancelacion del reject).
--   NINGUN flujo existente (081, 083, 079, 065, cleanup de seats)
--   toma FOR UPDATE sobre una fila EXISTENTE de payments: 083 solo
--   INSERTa pagos nuevos y lee idempotency sin bloquear. Por eso el
--   lock de payments es una hoja que no puede participar en un ciclo.
--   081 bloquea seats (status='locked') y luego INSERTa una reserva
--   NUEVA (sin lock de fila existente); el reject libera seats
--   (status='reserved') de una reserva EXISTENTE: filas disjuntas.
--   El cleanup periodico solo toca seats status='locked'; tras 083
--   los seats quedan 'reserved' con lock_expires_at=NULL, fuera del
--   alcance del cleanup. Verify NO bloquea seats (usa SELECT plano).
--
-- Modelo de autorizacion (Fase 6.2B — decision de negocio):
--   Solo usuarios con role='agency' pueden verificar o rechazar
--   comprobantes, y unicamente cuando el pago y la reserva pertenecen
--   a SU agencia. El backend resuelve el actor desde la sesion
--   autenticada y lo pasa como p_actor_user_id; la RPC valida
--   role='agency', obtiene agency_id del registro del usuario (nunca
--   del cliente) y verifica ownership contra payments.agency_id y
--   reservations.agency_id. No existe permiso break-glass para
--   superadmin en este dominio. Ejecucion SOLO via service_role.
--   auth.uid() es NULL bajo service_role; el patron de identidad es
--   el mismo de 079: p_actor_user_id + validacion en public.users.
--
-- Nota de validacion: las pruebas de este repo son ESTATICAS sobre el
-- texto de estas migraciones. No ejecutan PostgreSQL y por tanto NO
-- demuestran atomicidad, aislamiento ni ausencia de deadlocks reales;
-- eso se verifica contra una BD real en una fase posterior.
--
-- Migracion marketplace (074-086). Requiere 075, 076, 080, 081, 082,
-- 083 y 086 (los CHECK de auditoria) ya aplicados. 086 debe aplicarse
-- ANTES de EJECUTAR estas RPCs (ambas en el mismo release).
-- NO se toca: 074-084, 086, RPCs de tour, TTLs, triggers de outbox,
-- CHECK de seats, policies existentes.
--
-- Dry-run:   BEGIN;  \i 085_payment_admin_actions.sql   ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) verify_marketplace_payment
--    SECURITY DEFINER + EXECUTE solo service_role.
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
  IF v_total_expected <> v_payment.amount_cents THEN
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

  -- ── 12) Crear UNA allocation por pasajero activo (unit_price exacto).
  --       Sin ON CONFLICT: ya validamos count=0 y retenemos el lock del
  --       pago, asi que ninguna verificacion concurrente puede insertar
  --       allocations para este payment_id. Cualquier violacion unique
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
    rp.unit_price
  FROM public.reservation_passengers rp
  WHERE rp.reservation_id = v_payment.reservation_id
    AND rp.status = 'active'
    AND rp.unit_price IS NOT NULL
    AND rp.unit_price > 0
  ORDER BY rp.seat_id;

  GET DIAGNOSTICS v_alloc_count = ROW_COUNT;

  IF v_alloc_count <> v_active_count THEN
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
  --       Verificar cubre el 100% de los pasajeros activos -> fully_paid. ─
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
  'MKT-006 Fase 6.2B: verifica un comprobante marketplace. Actor agency con ownership: valida role=agency, obtiene agency_id del usuario (no del cliente) y verifica que el pago y la reserva pertenecen a esa agencia. En UNA transaccion bloquea payments (hoja) -> reservations -> passengers, valida estado pending+reserved, importe = SUM(unit_price) exacto y asientos coherentes, crea UNA allocation por pasajero activo, pasa el pago a verified (rowcount=1), recalcula payment_status=fully_paid y audita payment.verified con actor agency. Reintento sobre verified devuelve already_verified sin allocations ni auditoria duplicadas. SECURITY DEFINER; EXECUTE service_role only.';

-- ============================================================
-- 2) reject_marketplace_payment
--    SECURITY DEFINER + EXECUTE solo service_role.
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

  IF v_other_verified_count = 0 THEN
    -- ── PAGO INICIAL: cancelar la reserva marketplace ────────
    IF v_reservation.status = 'reserved' THEN

      -- 7a) Pasajeros activos con FOR UPDATE (orden por seat_id).
      FOR rec IN
        SELECT rp.id, rp.seat_id
        FROM public.reservation_passengers rp
        WHERE rp.reservation_id = v_payment.reservation_id
          AND rp.status = 'active'
        ORDER BY rp.seat_id
        FOR UPDATE
      LOOP
        v_active_count := v_active_count + 1;
        v_seat_ids := v_seat_ids || rec.seat_id;
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
    -- ── ABONO FUTURO (existen otros pagos verified): NO cancelar ──
    --     Solo se rechaza este pago y se recalcula payment_status.
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
  'MKT-006 Fase 6.2B: rechaza un comprobante marketplace. Actor agency con ownership: valida role=agency, obtiene agency_id del usuario (no del cliente) y verifica que el pago y la reserva pertenecen a esa agencia. Valida motivo (1-500 chars), bloquea payments (hoja) -> reservations, estado pending. Si es el pago INITIAL (sin otros verified) cancela la reserva reserved de forma atomica (pasajeros -> cancelled, seats -> available limpiando lock, reservation -> cancelled + payment_status) y NO crea refunds artificiales de importe cero. Si es un abono futuro (otros verified existen) NO cancela la reserva; solo rechaza y recalcula payment_status. Un verified nunca se rechaza (error). Reintento sobre rejected devuelve already_rejected sin efectos duplicados. Audita payment.rejected (actor agency) y, si cancelo, reservation.cancelled. SECURITY DEFINER; EXECUTE service_role only.';

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
