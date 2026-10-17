-- ============================================================
-- 090_checkout_reject_after_window.sql
-- Opcion A - MKT-007: rechazo despues del vencimiento de la ventana.
--
-- Problema:
--   reject_checkout_attempt (087:1424-1428) bloqueaba el rechazo con
--   ERR_CHECKOUT_WINDOW_EXPIRED cuando expires_at <= NOW(), asumiendo
--   que cleanup_expired_checkout_attempts marcaria el intento como
--   'expired'. El cleanup RPC no tiene invocador automatizado en el
--   codigo (ni backend ni workers ni edge functions ni cron en
--   migraciones), por lo que un intento vencido puede quedar en
--   'pending_review' de forma indefinida y la agencia no puede
--   registrar el rechazo de un comprobante que si llego a revision.
--
-- Decisiones aprobadas (auditoria previa):
--   1) El rechazo de pending_review despues de vencer expires_at es
--      TERMINAL: status = 'rejected_final'. El cliente ya no puede
--      reenviar (submit_checkout_proof exige ventana vigente,
--      087:803), por lo que un 'rejected' no final seria un callejon
--      sin salida que ademas el cleanup reescribiria a 'expired'
--      (087:1657), sobrescribiendo la decision de la agencia.
--   2) El rechazo tardio conserva motivo, historial y auditoria,
--      libera los locks propios del intento y devuelve
--      window_expired: true.
--   3) verify_checkout_attempt sigue bloqueado con la ventana
--      vencida (087:1017-1019 NO se toca).
--
-- Cambio de comportamiento (unico, respecto de 087/088/089):
--   reject_checkout_attempt: el guard ERR_CHECKOUT_WINDOW_EXPIRED se
--   sustituye por v_window_expired := (expires_at <= NOW()); cuando
--   es true, v_final se fuerza a true. El resto del cuerpo (razon
--   1-500, FOR UPDATE, autorizacion agency + ownership, idempotencia
--   sobre rejected/rejected_final, bloqueos de verified/expired/
--   cancelled/created, liberacion SOLO de seats con
--   checkout_attempt_id = este intento y status='locked', rowcount
--   race-guard, audit_append checkout.rejected) se conserva igual.
--
-- Aditivo (no rompe consumidores):
--   'window_expired' en el JSONB de respuesta (ruta de exito), en el
--   objeto de history y en el metadata de audit_log. Las rutas
--   idempotentes already_rejected mantienen su forma original.
--
-- Prohibido en esta migracion (no se toca nada mas):
--   verify_checkout_attempt, submit_checkout_proof,
--   cancel_checkout_attempt, cleanup_expired_checkout_attempts,
--   CHECK de status de checkout_attempts, tablas, indices, RLS,
--   triggers (ca_expired_emit_outbox_t de 088,
--   trg_seats_clear_checkout_attempt de 087), TTLs de locks
--   (Tour 600 s / Marketplace 900 s), worker T-1.
--
-- Rollback manual:
--   supabase/rollbacks/090_checkout_reject_after_window_rollback.sql
--   Restaura el cuerpo de 087. NO revierte datos: los intentos ya
--   convertidos en 'rejected_final' por vencimiento permanecen asi.
--
-- Dry-run:   BEGIN;  \i 090_checkout_reject_after_window.sql   ROLLBACK;
--
-- Escenarios de integracion que requieren validacion en PostgreSQL
-- (NO cubiertos por las pruebas estaticas de texto):
--   1) pending_review + expires_at vencido + reject =>
--      status='rejected_final', final=true, window_expired=true,
--      seats liberados (available + checkout_attempt_id NULL),
--      history y audit_log checkout.rejected presentes.
--   2) Mismo caso + verify => sigue ERR_CHECKOUT_WINDOW_EXPIRED.
--   3) reject sobre 'expired' => ERR_CHECKOUT_ATTEMPT_CLOSED;
--      reject sobre 'verified' => ERR_CHECKOUT_ALREADY_VERIFIED.
--   4) Re-rechazo del resultado del (1) => already_rejected=true,
--      sin escrituras nuevas.
--   5) cleanup_expired_checkout_attempts posterior al (1) => 0 filas.
--   6) submit_checkout_proof tras rechazo tardio =>
--      ERR_CHECKOUT_ATTEMPT_CLOSED.
--   7) Agencia ajena => ERR_CHECKOUT_AGENCY_MISMATCH.
--   8) Carrera reject <-> cleanup (dos sesiones concurrentes) =>
--      exactamente un ganador, sin doble liberacion de locks.
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
  v_window_expired BOOLEAN := false;
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

  -- 4) Ventana de revision (090): vencida ya NO impide rechazar. La
  --    hora autoritativa es la de PostgreSQL (NOW()). El rechazo
  --    tardio es terminal porque el cliente no puede reenviar.
  v_window_expired := v_attempt.expires_at <= NOW();

  v_remaining := GREATEST(3 - v_attempt.proof_count, 0);

  -- 5) Rechazo final: tercer comprobante rechazado O ventana ya
  --    vencida (090). En ambos casos se liberan los locks propios.
  IF v_window_expired OR v_attempt.proof_count >= 3 THEN
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
        'window_expired', v_window_expired,
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
      'window_expired', v_window_expired,
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
    'window_expired', v_window_expired,
    'proof_count', v_attempt.proof_count,
    'remaining_submissions', v_remaining,
    'rejection_reason', v_reason,
    'freed_seats', v_freed,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) IS
  'MKT-007 + 090 (Opcion A): rechaza el comprobante de un checkout_attempt. Con la ventana vigente y proof_count < 3 pasa a status=rejected (reenvio permitido, locks conservados, SIN abrir ventana nueva). Con proof_count = 3, o con la ventana vencida (expires_at <= now, v_window_expired), pasa a rejected_final y libera UNICAMENTE los seats con checkout_attempt_id = este intento; el rechazo tardio conserva motivo, historial y auditoria y responde window_expired=true. Idempotente sobre rejected/rejected_final. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reject_checkout_attempt(UUID, UUID, TEXT) TO service_role;
