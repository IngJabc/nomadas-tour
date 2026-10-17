-- ============================================================
-- 090_checkout_reject_after_window_rollback.sql
-- Rollback de la migracion 090 (Opcion A - rechazo tras vencimiento).
-- Ejecutar SOLO si la migracion 090 causa problemas en staging/prod.
--
-- Restaura el comportamiento previo de reject_checkout_attempt:
--   - Guard ERR_CHECKOUT_WINDOW_EXPIRED cuando expires_at <= NOW().
--   - v_final unicamente por proof_count >= 3.
--   - Sin campo window_expired en respuesta, historial ni auditoria.
--
-- IMPORTANTE - el rollback NO revierte datos:
--   Los intentos que ya se hayan convertido en 'rejected_final' por
--   el rechazo tardio (090) PERMANECEN en 'rejected_final', con su
--   motivo, historial y auditoria ya escritos, y sus asientos ya
--   liberados. Solo se restaura el comportamiento FUTURO de la
--   funcion.
--
-- La funcion se restaura identica a 087_checkout_attempts.sql
-- (secciones 1-5 del cuerpo, COMMENT y privilegios).
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
