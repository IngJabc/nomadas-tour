-- ============================================================
-- 079_cancel_reservation_passenger.sql
-- RPC de cancelacion por pasajero para el flujo marketplace.
--
-- CORRECCION 2026-10-02 tras fallo en staging.
--
-- Root cause: este archivo reemplazaba audit_log_action_check con el
-- listado de 9 acciones de 065_audit_log.sql, pero la definicion vigente
-- del CHECK la fija 069_reservation_link_rpcs.sql con 15 acciones (agrega
-- 6 reservation_link.*). Al hacer ADD CONSTRAINT, PostgreSQL valida TODAS
-- las filas existentes de audit_log -> "check constraint
-- audit_log_action_check of relation audit_log is violated by some row".
--
-- Regla corregida: los CHECK se AMPLIAN de forma aditiva (nada se quita)
-- y se protege con guard que falla con ruido si una migracion posterior
-- agrego acciones que 079 no conoce.
--
-- Contexto de negocio (business-rules marketplace seccion 6):
--   T-1: passenger con saldo pendiente
--     -> passenger cancelled
--     -> su seat available
--     -> refund_required por lo efectivamente pagado
--   Los demas pasajeros de la reserva quedan intactos.
--
-- Modelo de autorizacion: patron de 046_boarding_toggle_rpc.sql y de
-- cancel_agency_reservation (065). El actor llega como parametro tipado
-- resuelto por el backend; NO se confia en auth.uid() ni en claims JWT.
-- Ejecucion SOLO via service_role, igual que el resto de las RPCs.
--
-- Migracion marketplace 6 de 6 (074-079). Requiere 074-078 ya aplicados.
-- NO modifica 074-078. NO modifica cancel_agency_reservation.
--
-- Dry-run:   BEGIN;  \i 079_cancel_reservation_passenger.sql   ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) audit_log CHECKs - AMPLIACION ADITIVA
-- ============================================================

-- 1a) Guard: falla con mensaje claro si el CHECK vigente contiene una
--     accion que 079 no conoce (es decir, si una migracion posterior a 069
--     agrego valores). Evita silenciosamente quitar acciones a tour.
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
    'reservation.passenger_cancelled'
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
        RAISE EXCEPTION 'ERR_079_ACTION_GUARD: audit_log_action_check contiene la accion "%" que 079 no conoce. Una migracion posterior a 069 la agrego; mergear manualmente antes de aplicar 079.', v_lit;
      END IF;
    END LOOP;
  END IF;
END
$$;

-- 1b) Listado completo: 15 acciones de 069 + 1 nueva de marketplace.
--     Orden identico al de 069, el nuevo valor va al final.
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
      'reservation.passenger_cancelled'
    )
  );

COMMENT ON CONSTRAINT audit_log_action_check ON public.audit_log IS
  '065 + 069 (15 acciones) + 079 reservation.passenger_cancelled. Aditivo: no quitar valores.';

-- 1c) Guard equivalente para actor: preserva 'system' (065) y solo admite
--     ampliar el conjunto de roles.
DO $$
DECLARE
  v_current TEXT;
  v_lit TEXT;
  v_known TEXT[] := ARRAY['system', 'superadmin', 'agency', 'customer'];
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_current
  FROM pg_constraint
  WHERE conrelid = 'public.audit_log'::regclass
    AND conname = 'audit_log_actor_check';

  IF v_current IS NOT NULL THEN
    FOR v_lit IN
      SELECT x[1]
      FROM regexp_matches(v_current, $re$'([^']+)'$re$, 'g') AS r(x)
    LOOP
      IF NOT (v_lit = ANY(v_known)) THEN
        RAISE EXCEPTION 'ERR_079_ACTOR_GUARD: audit_log_actor_check contiene el valor "%" que 079 no conoce. Mergear manualmente antes de aplicar 079.', v_lit;
      END IF;
    END LOOP;
  END IF;
END
$$;

-- 1d) actor_check: comportamiento de 065 identico + 'customer'.
--     Se conserva la rama (actor_user_id IS NULL AND actor_role = 'system')
--     para las operaciones internas (worker T-1).
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_actor_check CHECK (
    (actor_user_id IS NULL AND actor_role = 'system')
    OR (
      actor_user_id IS NOT NULL
      AND actor_role IN ('superadmin', 'agency', 'customer')
    )
  );

COMMENT ON CONSTRAINT audit_log_actor_check ON public.audit_log IS
  '065 (system | superadmin | agency) + 079 customer. Aditivo: no quitar valores.';

-- 1e) NOTA sobre entity_type: NO se toca. 069 ya permite
--     'reservation_passenger', que es el que usa esta RPC.

-- ============================================================
-- 2) RPC
-- ============================================================

-- Firma nueva (p_actor_user_id). Si un intento anterior dejo creada la
-- version de un solo parametro, se elimina para no dejar dos sobrecargas.
DROP FUNCTION IF EXISTS public.cancel_reservation_passenger(UUID);

CREATE OR REPLACE FUNCTION public.cancel_reservation_passenger(
  p_passenger_id UUID,
  p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation_id    UUID;
  v_passenger         public.reservation_passengers%ROWTYPE;
  v_reservation       public.reservations%ROWTYPE;
  v_actor_role        TEXT;
  v_audit_actor_id    UUID;
  v_audit_actor_role  TEXT;
  v_refund_cents      INTEGER := 0;
  v_seat_released     BOOLEAN := false;
  v_active_left       INTEGER := 0;
  v_new_status        TEXT;
BEGIN
  IF p_passenger_id IS NULL THEN
    RAISE EXCEPTION 'ERR_079_PARAMS: p_passenger_id es obligatorio';
  END IF;

  -- 2.1) Resolver reservation_id sin bloquear (orden estable de 046)
  SELECT rp.reservation_id
  INTO v_reservation_id
  FROM public.reservation_passengers rp
  WHERE rp.id = p_passenger_id;

  IF v_reservation_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAX_NOT_FOUND: el pasajero % no existe', p_passenger_id;
  END IF;

  -- 2.2) Lock orden deadlock-safe de 046: reservations -> passengers
  SELECT r.*
  INTO v_reservation
  FROM public.reservations r
  WHERE r.id = v_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_RESERVATION_NOT_FOUND: la reserva % no existe', v_reservation_id;
  END IF;

  SELECT rp.*
  INTO v_passenger
  FROM public.reservation_passengers rp
  WHERE rp.id = p_passenger_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAX_NOT_FOUND: el pasajero % no existe', p_passenger_id;
  END IF;

  -- 2.3) Alcance: solo reservas marketplace (las internal son de tour)
  IF v_reservation.source <> 'marketplace' THEN
    RAISE EXCEPTION 'ERR_SCOPE: la reserva % es internal; esta RPC es solo marketplace', v_reservation.id;
  END IF;

  -- 2.4) Estados terminales de reserva: no se puede retroceder
  IF v_reservation.status IN ('completed', 'boarded') THEN
    RAISE EXCEPTION 'ERR_RESERVATION_TERMINAL: la reserva % ya esta en estado %', v_reservation.id, v_reservation.status;
  END IF;

  -- 2.5) Autorizacion
  --      system  -> p_actor_user_id NULL: worker T-1 / operacion interna.
  --                 Solo es legitimo si NO hay un JWT de usuario final en
  --                 contexto (si lo hay, es un cliente fin intentando actuar
  --                 como system y se rechaza).
  --      superadmin -> cualquier reserva marketplace.
  --      customer   -> unicamente si es el dueno de la reserva.
  --      agency y cualquier otro rol -> denegado (no es este dominio).
  IF p_actor_user_id IS NULL THEN
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'ERR_SYSTEM_ACTOR: la operacion interna no puede ejecutarse con un JWT de usuario final';
    END IF;
    v_audit_actor_id := NULL;
    v_audit_actor_role := 'system';
  ELSE
    SELECT u.role
    INTO v_actor_role
    FROM public.users u
    WHERE u.id = p_actor_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ERR_ACTOR_NOT_FOUND: el actor % no existe en public.users', p_actor_user_id;
    END IF;

    v_audit_actor_id := p_actor_user_id;
    v_audit_actor_role := v_actor_role;

    IF v_actor_role = 'superadmin' THEN
      NULL;
    ELSIF v_actor_role = 'customer' THEN
      IF v_reservation.customer_id IS DISTINCT FROM p_actor_user_id THEN
        RAISE EXCEPTION 'ERR_FORBIDDEN: la reserva % no pertenece al cliente %', v_reservation.id, p_actor_user_id;
      END IF;
    ELSE
      RAISE EXCEPTION 'ERR_ACTOR_ROLE: el rol "%" no puede cancelar pasajeros marketplace', v_actor_role;
    END IF;
  END IF;

  -- 2.6) Idempotencia: ya cancelado -> no-op
  IF v_passenger.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'reservation_id', v_reservation.id,
      'passenger_id', p_passenger_id,
      'already_cancelled', true,
      'reservation_status', v_reservation.status,
      'seat_released', false,
      'refund_required', false,
      'refund_amount_cents', 0,
      'actor_role', v_audit_actor_role
    );
  END IF;

  -- 2.7) El pasajero debe estar activo para poder cancelarse
  IF v_passenger.status <> 'active' THEN
    RAISE EXCEPTION 'ERR_PAX_STATUS: el pasajero % no esta en estado cancelable (%)', p_passenger_id, v_passenger.status;
  END IF;

  -- 2.8) Marcar pasajero cancelado (solo el, los demas quedan intactos)
  UPDATE public.reservation_passengers
  SET status = 'cancelled'
  WHERE id = p_passenger_id;

  -- 2.9) Liberar SOLO su asiento, limpiando TODA la metadata de lock
  --      (068 agrego lock_expires_at; el trigger trg_seats_clear_lock_on_available
  --      de 068 hace lo mismo, se escribe igual por defensa).
  --      seats.status conserva el CHECK de tour:
  --      available|locked|reserved|blocked|guide
  UPDATE public.seats
  SET status = 'available',
      locked_by = NULL,
      locked_at = NULL,
      lock_expires_at = NULL,
      updated_at = now()
  WHERE id = v_passenger.seat_id
    AND status IN ('locked', 'reserved');

  v_seat_released := FOUND;

  -- 2.10) Refund: solo dinero de pagos VERIFICADOS
  SELECT COALESCE(SUM(pa.amount_cents), 0)
  INTO v_refund_cents
  FROM public.payment_allocations pa
  JOIN public.payments p
    ON p.id = pa.payment_id
   AND p.status = 'verified'
  WHERE pa.reservation_passenger_id = p_passenger_id;

  IF v_refund_cents > 0 THEN
    INSERT INTO public.reservation_refunds (
      reservation_id,
      reservation_passenger_id,
      amount_cents,
      reason,
      status,
      idempotency_key,
      requested_by
    )
    VALUES (
      v_reservation.id,
      p_passenger_id,
      v_refund_cents,
      'deadline_T1',
      'required',
      'pax_cancel:' || p_passenger_id::text,
      p_actor_user_id
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  -- 2.11) Recalcular estado de la reserva SOLO si ya no quedan activos
  SELECT count(*)
  INTO v_active_left
  FROM public.reservation_passengers
  WHERE reservation_id = v_reservation.id
    AND status = 'active';

  IF v_active_left = 0 THEN
    UPDATE public.reservations
    SET status = 'cancelled'
    WHERE id = v_reservation.id
      AND status NOT IN ('completed', 'boarded');
  END IF;

  -- 2.12) Auditoria: INSERT directo, NO audit_append() porque esa funcion
  --       de 065 rechaza actor_role 'customer' en su guard interno.
  INSERT INTO public.audit_log (
    actor_user_id,
    actor_role,
    agency_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    metadata
  )
  VALUES (
    v_audit_actor_id,
    v_audit_actor_role,
    v_reservation.agency_id,
    'reservation.passenger_cancelled',
    'reservation_passenger',
    p_passenger_id,
    jsonb_build_object('passenger_status', v_passenger.status, 'seat_id', v_passenger.seat_id),
    jsonb_build_object('passenger_status', 'cancelled'),
    jsonb_build_object(
      'reservation_id', v_reservation.id,
      'source', v_reservation.source,
      'seat_released', v_seat_released,
      'refund_amount_cents', v_refund_cents,
      'refund_reason', 'deadline_T1',
      'actor_role', v_audit_actor_role
    )
  );

  -- 2.13) Respuesta
  SELECT status INTO v_new_status
  FROM public.reservations
  WHERE id = v_reservation.id;

  RETURN jsonb_build_object(
    'reservation_id', v_reservation.id,
    'passenger_id', p_passenger_id,
    'already_cancelled', false,
    'reservation_status', v_new_status,
    'active_passengers_left', v_active_left,
    'seat_released', v_seat_released,
    'refund_required', v_refund_cents > 0,
    'refund_amount_cents', v_refund_cents,
    'actor_role', v_audit_actor_role
  );
END;
$$;

-- ============================================================
-- 3) Seguridad - mismo patron que 046 / cancel_agency_reservation (065)
-- ============================================================

COMMENT ON FUNCTION public.cancel_reservation_passenger(UUID, UUID) IS
  '079/T-1: cancela UN pasajero de una reserva marketplace, libera su seat limpando lock_expires_at y crea refund deadline_T1 si tenia pago verificado. Idempotente. No aplica a reservas internal. p_actor_user_id NULL = operacion system (worker). SECURITY DEFINER; EXECUTE service_role only.';

-- Owner explicito, igual que 046 y 065
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.cancel_reservation_passenger(UUID, UUID) OWNER TO postgres;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.cancel_reservation_passenger(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_reservation_passenger(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_reservation_passenger(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_passenger(UUID, UUID) TO service_role;

-- ============================================================
-- 4) Sin outbox en esta RPC (decision)
--   cancel_agency_reservation (065), el equivalente de tour, solo escribe
--   audit_append y no emite eventos a outbox_events. La comunicacion T-1 al
--   cliente es responsabilidad del worker marketplace (P10, todavia no
--   existe). Emitir un evento sin consumidor lo dejaria 'pending' sin uso.
-- ============================================================