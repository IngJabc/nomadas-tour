-- ============================================================
-- 089_agency_payment_methods.sql
-- MKT-007.4 - Canales de pago de agencia visibles en el checkout.
--
-- Objetivo:
--   Dar a cada agencia un registro de COMO quiere recibir el pago
--   (por ahora unico metodo: pago_movil). El marketplace muestra el
--   canal (banco, telefono, titular, documento) antes de que el
--   cliente suba el comprobante, y el canal elegido queda congelado
--   como SNAPSHOT en el intento de compra.
--
-- Contexto (migraciones ya existentes, NO se modifican):
--   006 agencies.phone (telefono publico de la agencia) y RLS
--       agencies_public_read.
--   041 agency_settings (solo branding; NO se reutiliza para canales).
--   065 audit_append() y audit_log (actor guard: system|superadmin|
--       agency|customer).
--   076 payments (conciliacion: external_reference, amount_cents).
--   087 checkout_attempts (intento de compra, estados, locks,
--       submit/verify/reject/cancel) + audit_log CHECK ampliado.
--   088 triggers outbox de cancelaciones (no toca columnas aqui).
--
-- Modelo de datos:
--   agency_payment_methods: canales configurados por la agencia.
--     method TEXT CHECK (method IN ('pago_movil')) - hoy solo uno,
--     la estructura admite mas metodos sin romper el snapshot.
--     data JSONB: los datos del canal validados en RPC y en el
--     backend (Zod). Borrado LOGICO (deleted_at); la fila es
--     historica para los snapshots.
--   checkout_attempts.payment_method_id + payment_method_snapshot:
--     el canal elegido por el cliente y una copia JSONB inmutable
--     ({method,label,data,snapshot_version,selected_at}). El snapshot
--     se conserva aunque el canal se desactive o se borre.
--
-- Regla de negocio (bloqueo de edicion):
--   create/update/set_primary/delete de canales fallan con
--   ERR_AGENCY_HAS_ACTIVE_CHECKOUTS mientras exista UN intento de la
--   agencia en status 'created' o 'pending_review'. La proteccion es
--   atomica: cada RPC de mutacion toma LOCK TABLE
--   public.checkout_attempts IN SHARE ROW EXCLUSIVE MODE ANTES de
--   consultar los intentos, de modo que un create_checkout_attempt
--   concurrente (INSERT = ROW EXCLUSIVE) serializa con la mutacion.
--   Las lecturas de canales NO se bloquean.
--
-- Inmutabilidad del canal en el intento:
--   El cliente puede cambiar el canal SOLO mientras status='created'
--   y proof_count=0 (aun sin comprobante). Una vez enviado el primer
--   comprobante (proof_count>=1, status='pending_review' o peor) el
--   canal queda congelado: el trigger
--   trg_checkout_attempts_protect_payment_method rechaza cualquier
--   UPDATE que intente cambiar payment_method_id o
--   payment_method_snapshot. Tambien el CHECK
--   checkout_attempts_payment_method_check exige canal asignado en
--   'pending_review' (NOT VALID: filas previas en staging).
--
-- Orden de locks (deadlock-safe):
--   Agencia (SRX sobre checkout_attempts) -> agency_payment_methods
--   (row lock). Cliente: checkout_attempts (row lock FOR UPDATE) ->
--   agency_payment_methods (row lock). create_checkout_attempt:
--   INSERT (ROW EXCLUSIVE sobre checkout_attempts) -> seats FOR
--   UPDATE. El orden de tablas es siempre attempts -> methods ->
--   seats, por lo que no hay ciclos.
--
-- Privilegios:
--   agency_payment_methods: RLS habilitada, deny-by-default, solo
--   service_role (mismo patron que checkout_attempts 087). Las RPC:
--   SECURITY DEFINER + EXECUTE solo service_role.
--
-- Prohibido en esta migracion:
--   Editar o renombrar 001-088; tocar RPCs existentes de 087; tocar
--   TTLs; tocar CHECK de seats; crear tabla de bancos; BEGIN/COMMIT;
--   SQL de rollback.
--
-- Dry-run:   BEGIN;  \i 089_agency_payment_methods.sql   ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) audit_log: ampliacion ADITIVA de CHECKs (patron guard de 086
--    y 087). Acciones nuevas: agency_payment_method.created /
--    .updated / .primary_set / .deleted. Entidad nueva:
--    agency_payment_method. audit_log_actor_check NO se toca.
-- ============================================================

-- 1a) Guard de acciones.
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
    'checkout.cancelled',
    'agency_payment_method.created',
    'agency_payment_method.updated',
    'agency_payment_method.primary_set',
    'agency_payment_method.deleted'
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
        RAISE EXCEPTION 'ERR_089_ACTION_GUARD: audit_log_action_check contiene la accion "%" que 089 no conoce. Una migracion posterior agrego valores; mergear manualmente antes de aplicar 089.', v_lit;
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
      'checkout.cancelled',
      'agency_payment_method.created',
      'agency_payment_method.updated',
      'agency_payment_method.primary_set',
      'agency_payment_method.deleted'
    )
  );

COMMENT ON CONSTRAINT audit_log_action_check ON public.audit_log IS
  '065 + 069 + 079 (16) + 086 payment (2) + 087 checkout (4) + 089 agency_payment_method (4). Aditivo: no quitar valores.';

-- 1b) Guard de entidades.
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
    'checkout_attempt',
    'agency_payment_method'
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
        RAISE EXCEPTION 'ERR_089_ENTITY_GUARD: audit_log_entity_type_check contiene el valor "%" que 089 no conoce. Una migracion posterior agrego valores; mergear manualmente antes de aplicar 089.', v_lit;
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
      'checkout_attempt',
      'agency_payment_method'
    )
  );

COMMENT ON CONSTRAINT audit_log_entity_type_check ON public.audit_log IS
  '065 + 069 (6) + 086 payment (1) + 087 checkout_attempt (1) + 089 agency_payment_method (1). Aditivo: no quitar valores.';

-- ============================================================
-- 2) Tabla agency_payment_methods
-- ============================================================

CREATE TABLE public.agency_payment_methods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  method TEXT NOT NULL
    CHECK (method IN ('pago_movil')),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(data) = 'object'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Un unico canal primario por agencia+metodo entre filas vivas.
CREATE UNIQUE INDEX uq_agency_payment_methods_primary
  ON public.agency_payment_methods (agency_id, method)
  WHERE is_primary AND deleted_at IS NULL;

-- Listado por agencia: solo vivos, primarios primero.
CREATE INDEX idx_agency_payment_methods_agency
  ON public.agency_payment_methods (agency_id, is_active, sort_order, created_at)
  WHERE deleted_at IS NULL;

-- Canales referenciados por un intento (historico / snapshot).
CREATE INDEX idx_agency_payment_methods_by_id
  ON public.agency_payment_methods (id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.agency_payment_methods IS
  'MKT-007.4: canales de pago configurados por la agencia para el checkout del marketplace. Borrado logico (deleted_at); la fila se conserva porque los intentos referencian su snapshot.';
COMMENT ON COLUMN public.agency_payment_methods.method IS
  'MKT-007.4: hoy solo pago_movil. La estructura (enum TEXT + CHECK) admite mas metodos sin migracion de datos.';
COMMENT ON COLUMN public.agency_payment_methods.data IS
  'MKT-007.4: datos del canal validados en RPC y en el backend (Zod). Para pago_movil: bank_code, bank_name, phone, document_type, document_number, holder_name y opcionales account_type/account_number.';
COMMENT ON COLUMN public.agency_payment_methods.is_primary IS
  'MKT-007.4: canal destacado en el checkout. Unico por agencia+metodo entre filas vivas (indice parcial).';
COMMENT ON COLUMN public.agency_payment_methods.deleted_at IS
  'MKT-007.4: borrado logico. Un canal borrado deja de ofrecerse en checkout; su snapshot en los intentos se conserva.';

ALTER TABLE public.agency_payment_methods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agency_payment_methods FROM PUBLIC;
REVOKE ALL ON TABLE public.agency_payment_methods FROM anon;
REVOKE ALL ON TABLE public.agency_payment_methods FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agency_payment_methods TO service_role;

CREATE TRIGGER agency_payment_methods_updated_t
  BEFORE UPDATE ON public.agency_payment_methods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 3) checkout_attempts: canal elegido + snapshot inmutable
-- ============================================================

ALTER TABLE public.checkout_attempts
  ADD COLUMN IF NOT EXISTS payment_method_id UUID
    REFERENCES public.agency_payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method_snapshot JSONB;

COMMENT ON COLUMN public.checkout_attempts.payment_method_id IS
  'MKT-007.4: canal de pago elegido por el cliente. ON DELETE SET NULL: si la agencia borra el canal, el intento conserva el snapshot.';
COMMENT ON COLUMN public.checkout_attempts.payment_method_snapshot IS
  'MKT-007.4: copia inmutable del canal al momento de elegirlo: {method,label,data,snapshot_version,selected_at}. El trigger trg_checkout_attempts_protect_payment_method impide cambiarla una vez enviado el primer comprobante.';

CREATE INDEX IF NOT EXISTS idx_checkout_attempts_payment_method_id
  ON public.checkout_attempts (payment_method_id)
  WHERE payment_method_id IS NOT NULL;

-- 3a) pending_review exige canal asignado. NOT VALID: no valida
--     filas previas (staging). Se valida en un paso posterior.
ALTER TABLE public.checkout_attempts
  DROP CONSTRAINT IF EXISTS checkout_attempts_payment_method_check;
ALTER TABLE public.checkout_attempts
  ADD CONSTRAINT checkout_attempts_payment_method_check
  CHECK (status <> 'pending_review' OR payment_method_id IS NOT NULL)
  NOT VALID;

COMMENT ON CONSTRAINT checkout_attempts_payment_method_check ON public.checkout_attempts IS
  'MKT-007.4: un intento en pending_review siempre tiene canal elegido. NOT VALID: validar en paso posterior sobre staging.';

-- 3b) Inmutabilidad del canal: una vez enviado el primer comprobante
--     (proof_count >= 1) el canal elegido no cambia mas, ni siquiera
--     tras un rechazo con reenvio.
CREATE OR REPLACE FUNCTION public.checkout_attempts_protect_payment_method()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.proof_count >= 1
     AND (NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id
          OR NEW.payment_method_snapshot IS DISTINCT FROM OLD.payment_method_snapshot) THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_PAYMENT_METHOD_FROZEN: The payment method is frozen after the first proof submission';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_checkout_attempts_protect_payment_method ON public.checkout_attempts;
CREATE TRIGGER trg_checkout_attempts_protect_payment_method
  BEFORE UPDATE ON public.checkout_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.checkout_attempts_protect_payment_method();

-- ============================================================
-- 4) Validacion de datos del canal (pago_movil). Defensa en
--    profundidad: el backend ya valida con Zod; aqui se protege el
--    snapshot que vera el marketplace.
-- ============================================================

CREATE OR REPLACE FUNCTION public.agency_payment_method_validate_data(
  p_method TEXT,
  p_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_bank_code TEXT;
  v_bank_name TEXT;
  v_phone TEXT;
  v_doc_type TEXT;
  v_doc_number TEXT;
  v_holder TEXT;
  v_account_type TEXT;
  v_account_number TEXT;
BEGIN
  IF p_method IS DISTINCT FROM 'pago_movil' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_UNSUPPORTED: Method % is not supported', p_method;
  END IF;

  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_DATA: data must be a JSON object';
  END IF;

  v_bank_code := NULLIF(btrim(COALESCE(p_data->>'bank_code', '')), '');
  v_bank_name := NULLIF(btrim(COALESCE(p_data->>'bank_name', '')), '');
  v_phone := NULLIF(btrim(COALESCE(p_data->>'phone', '')), '');
  v_doc_type := NULLIF(btrim(COALESCE(p_data->>'document_type', '')), '');
  v_doc_number := NULLIF(btrim(COALESCE(p_data->>'document_number', '')), '');
  v_holder := NULLIF(btrim(COALESCE(p_data->>'holder_name', '')), '');
  v_account_type := NULLIF(btrim(COALESCE(p_data->>'account_type', '')), '');
  v_account_number := NULLIF(btrim(COALESCE(p_data->>'account_number', '')), '');

  IF v_bank_code IS NULL OR v_bank_code !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_DATA: bank_code must be 4 digits';
  END IF;
  IF v_bank_name IS NULL OR length(v_bank_name) > 80 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_DATA: bank_name is required (max 80 chars)';
  END IF;
  IF v_phone IS NULL OR v_phone !~ '^04[0-9]{9}$' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_DATA: phone must match 04XXXXXXXXX';
  END IF;
  IF v_doc_type IS NULL OR v_doc_type NOT IN ('V', 'E', 'J', 'G') THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_DATA: document_type must be V, E, J or G';
  END IF;
  IF v_doc_number IS NULL OR v_doc_number !~ '^[0-9]{6,9}$' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_DATA: document_number must be 6 to 9 digits';
  END IF;
  IF v_holder IS NULL OR length(v_holder) > 120 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_DATA: holder_name is required (max 120 chars)';
  END IF;
  IF v_account_type IS NOT NULL AND v_account_type NOT IN ('checking', 'savings') THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_DATA: account_type must be checking or savings';
  END IF;
  IF v_account_number IS NOT NULL AND (v_account_number !~ '^[0-9]{1,30}$') THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_DATA: account_number must be digits only (max 30)';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.agency_payment_method_validate_data(TEXT, JSONB) IS
  'MKT-007.4: valida los datos de un canal pago_movil (bank_code 4 digitos, phone 04XXXXXXXXX, document V/E/J/G de 6-9 digitos, holder_name). Lanza ERR_PAYMENT_METHOD_DATA / ERR_PAYMENT_METHOD_UNSUPPORTED. Solo la invocan las RPC de esta migracion.';

REVOKE ALL ON FUNCTION public.agency_payment_method_validate_data(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agency_payment_method_validate_data(TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.agency_payment_method_validate_data(TEXT, JSONB) FROM authenticated;

-- ============================================================
-- 5) Bloqueo compartido: SRX sobre checkout_attempts + consulta de
--    intentos activos de la agencia. Todas las RPC de mutacion de
--    canales lo invocan ANTES de escribir (regla MKT-007.4).
-- ============================================================

CREATE OR REPLACE FUNCTION public.agency_payment_methods_lock_agency(
  p_agency_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_agency_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_INPUT: p_agency_id is required';
  END IF;

  -- SRX es compatible con los INSERT de checkout_attempts? NO:
  -- ROW EXCLUSIVE (INSERT) y SHARE ROW EXCLUSIVE se excluyen entre
  -- si, por lo que un create_checkout_attempt concurrente espera a
  -- que termine la mutacion del canal (o viceversa). SRX tambien
  -- excluye a otro SRX, asi que dos mutaciones concurrentes se
  -- serializan. Los SELECT (MVCC) no toman lock de tabla y leen sin
  -- espera.
  LOCK TABLE public.checkout_attempts IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
    FROM public.checkout_attempts ca
    WHERE ca.agency_id = p_agency_id
      AND ca.status IN ('created', 'pending_review')
  ) THEN
    RAISE EXCEPTION 'ERR_AGENCY_HAS_ACTIVE_CHECKOUTS: No se pueden modificar los canales de pago mientras existan compras activas de la agencia';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.agency_payment_methods_lock_agency(UUID) IS
  'MKT-007.4: toma LOCK TABLE checkout_attempts IN SHARE ROW EXCLUSIVE MODE y rechaza con ERR_AGENCY_HAS_ACTIVE_CHECKOUTS si la agencia tiene intentos activos (created|pending_review). Invocar siempre ANTES de mutar canales. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.agency_payment_methods_lock_agency(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agency_payment_methods_lock_agency(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.agency_payment_methods_lock_agency(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.agency_payment_methods_lock_agency(UUID) TO service_role;

-- ============================================================
-- 6) create_agency_payment_method
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_agency_payment_method(
  p_agency_id UUID,
  p_actor_user_id UUID,
  p_method TEXT,
  p_label TEXT,
  p_data JSONB,
  p_is_primary BOOLEAN,
  p_sort_order INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_label TEXT;
  v_new_id UUID;
  v_row public.agency_payment_methods%ROWTYPE;
  v_audit_id UUID;
  v_is_primary BOOLEAN;
BEGIN
  -- 1) Actor: agency con ownership de la agencia. agency_id NUNCA
  --    llega del cliente; se resuelve del registro public.users.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_ACTOR: Actor not found';
  END IF;

  SELECT u.* INTO v_actor
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_ACTOR: Actor not found';
  END IF;

  IF v_actor.role IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_ROLE: Only agency users can manage payment methods';
  END IF;

  IF v_actor.agency_id IS NULL
     OR v_actor.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_AGENCY: Payment method does not belong to this agency';
  END IF;

  -- 2) Bloqueo + regla de negocio (ver seccion 5).
  PERFORM public.agency_payment_methods_lock_agency(p_agency_id);

  -- 3) Entrada.
  v_label := NULLIF(btrim(COALESCE(p_label, '')), '');
  IF v_label IS NULL OR length(v_label) > 60 THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_DATA: label is required (max 60 chars)';
  END IF;

  IF p_method IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_UNSUPPORTED: method is required';
  END IF;

  PERFORM public.agency_payment_method_validate_data(p_method, p_data);

  v_is_primary := COALESCE(p_is_primary, false);

  -- 4) Si es primario, quitar el primario vigente de la agencia.
  IF v_is_primary THEN
    UPDATE public.agency_payment_methods apm
    SET is_primary = false
    WHERE apm.agency_id = p_agency_id
      AND apm.method = p_method
      AND apm.is_primary
      AND apm.deleted_at IS NULL;
  END IF;

  INSERT INTO public.agency_payment_methods (
    agency_id, method, label, data, is_active, is_primary, sort_order
  ) VALUES (
    p_agency_id, p_method, v_label, p_data, true, v_is_primary,
    COALESCE(p_sort_order, 0)
  )
  RETURNING id INTO v_new_id;

  SELECT * INTO v_row
  FROM public.agency_payment_methods apm
  WHERE apm.id = v_new_id;

  -- 5) Auditoria (actor 'agency', acciones 089).
  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    p_agency_id,
    'agency_payment_method.created',
    'agency_payment_method',
    v_new_id,
    NULL,
    jsonb_build_object(
      'method', v_row.method,
      'label', v_row.label,
      'is_primary', v_row.is_primary,
      'is_active', v_row.is_active
    ),
    jsonb_build_object('trigger', 'mkt007_4')
  );

  RETURN jsonb_build_object(
    'payment_method', to_jsonb(v_row),
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.create_agency_payment_method(UUID, UUID, TEXT, TEXT, JSONB, BOOLEAN, INTEGER) IS
  'MKT-007.4: crea un canal de pago de la agencia (hoy pago_movil). Valida actor agency con ownership, toma agency_payment_methods_lock_agency (SRX + sin intentos activos), valida label y data, si is_primary limpia el primario vigente, INSERTa y audita agency_payment_method.created. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.create_agency_payment_method(UUID, UUID, TEXT, TEXT, JSONB, BOOLEAN, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_agency_payment_method(UUID, UUID, TEXT, TEXT, JSONB, BOOLEAN, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.create_agency_payment_method(UUID, UUID, TEXT, TEXT, JSONB, BOOLEAN, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_agency_payment_method(UUID, UUID, TEXT, TEXT, JSONB, BOOLEAN, INTEGER) TO service_role;

-- ============================================================
-- 7) update_agency_payment_method
--    NULL en label/data/is_active significa "no cambiar".
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_agency_payment_method(
  p_agency_id UUID,
  p_actor_user_id UUID,
  p_method_id UUID,
  p_label TEXT,
  p_data JSONB,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_row public.agency_payment_methods%ROWTYPE;
  v_before JSONB;
  v_label TEXT;
  v_audit_id UUID;
BEGIN
  -- 1) Actor.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_ACTOR: Actor not found';
  END IF;

  SELECT u.* INTO v_actor
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_ACTOR: Actor not found';
  END IF;

  IF v_actor.role IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_ROLE: Only agency users can manage payment methods';
  END IF;

  IF v_actor.agency_id IS NULL
     OR v_actor.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_AGENCY: Payment method does not belong to this agency';
  END IF;

  IF p_method_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_NOT_FOUND: Payment method not found';
  END IF;

  -- 2) Bloqueo + regla de negocio.
  PERFORM public.agency_payment_methods_lock_agency(p_agency_id);

  -- 3) Canal vigente de ESTA agencia, con lock de fila.
  SELECT * INTO v_row
  FROM public.agency_payment_methods apm
  WHERE apm.id = p_method_id
    AND apm.agency_id = p_agency_id
    AND apm.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_NOT_FOUND: Payment method not found';
  END IF;

  v_before := jsonb_build_object(
    'method', v_row.method,
    'label', v_row.label,
    'is_primary', v_row.is_primary,
    'is_active', v_row.is_active
  );

  -- 4) Entrada: solo los campos enviados cambian.
  IF p_label IS NOT NULL THEN
    v_label := NULLIF(btrim(p_label), '');
    IF v_label IS NULL OR length(v_label) > 60 THEN
      RAISE EXCEPTION 'ERR_PAYMENT_METHOD_DATA: label is required (max 60 chars)';
    END IF;
  END IF;

  IF p_data IS NOT NULL THEN
    PERFORM public.agency_payment_method_validate_data(v_row.method, p_data);
  END IF;

  -- 4b) Desactivar un canal primario tambien lo baja del primario.
  UPDATE public.agency_payment_methods apm
  SET label = COALESCE(v_label, apm.label),
      data = COALESCE(p_data, apm.data),
      is_active = COALESCE(p_is_active, apm.is_active),
      is_primary = CASE
        WHEN p_is_active = false THEN false
        ELSE apm.is_primary
      END
  WHERE apm.id = p_method_id;

  SELECT * INTO v_row
  FROM public.agency_payment_methods apm
  WHERE apm.id = p_method_id;

  -- 5) Auditoria.
  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    p_agency_id,
    'agency_payment_method.updated',
    'agency_payment_method',
    p_method_id,
    v_before,
    jsonb_build_object(
      'method', v_row.method,
      'label', v_row.label,
      'is_primary', v_row.is_primary,
      'is_active', v_row.is_active
    ),
    jsonb_build_object('trigger', 'mkt007_4')
  );

  RETURN jsonb_build_object(
    'payment_method', to_jsonb(v_row),
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.update_agency_payment_method(UUID, UUID, UUID, TEXT, JSONB, BOOLEAN) IS
  'MKT-007.4: actualiza label/data/is_active de un canal vigente de la agencia (NULL = no cambiar). Desactivar un canal primario lo baja del primario. Valida actor, toma agency_payment_methods_lock_agency, audita agency_payment_method.updated. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.update_agency_payment_method(UUID, UUID, UUID, TEXT, JSONB, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_agency_payment_method(UUID, UUID, UUID, TEXT, JSONB, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.update_agency_payment_method(UUID, UUID, UUID, TEXT, JSONB, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_agency_payment_method(UUID, UUID, UUID, TEXT, JSONB, BOOLEAN) TO service_role;

-- ============================================================
-- 8) set_agency_payment_method_primary
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_agency_payment_method_primary(
  p_agency_id UUID,
  p_actor_user_id UUID,
  p_method_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_row public.agency_payment_methods%ROWTYPE;
  v_audit_id UUID;
BEGIN
  -- 1) Actor.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_ACTOR: Actor not found';
  END IF;

  SELECT u.* INTO v_actor
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_ACTOR: Actor not found';
  END IF;

  IF v_actor.role IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_ROLE: Only agency users can manage payment methods';
  END IF;

  IF v_actor.agency_id IS NULL
     OR v_actor.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_AGENCY: Payment method does not belong to this agency';
  END IF;

  IF p_method_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_NOT_FOUND: Payment method not found';
  END IF;

  -- 2) Bloqueo + regla de negocio.
  PERFORM public.agency_payment_methods_lock_agency(p_agency_id);

  -- 3) Canal vigente, activo y de ESTA agencia.
  SELECT * INTO v_row
  FROM public.agency_payment_methods apm
  WHERE apm.id = p_method_id
    AND apm.agency_id = p_agency_id
    AND apm.deleted_at IS NULL
    AND apm.is_active
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_NOT_FOUND: Payment method not found or inactive';
  END IF;

  -- 4) Un solo primario por agencia+metodo.
  UPDATE public.agency_payment_methods apm
  SET is_primary = false
  WHERE apm.agency_id = p_agency_id
    AND apm.method = v_row.method
    AND apm.is_primary
    AND apm.deleted_at IS NULL
    AND apm.id <> p_method_id;

  UPDATE public.agency_payment_methods apm
  SET is_primary = true
  WHERE apm.id = p_method_id;

  SELECT * INTO v_row
  FROM public.agency_payment_methods apm
  WHERE apm.id = p_method_id;

  -- 5) Auditoria.
  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    p_agency_id,
    'agency_payment_method.primary_set',
    'agency_payment_method',
    p_method_id,
    NULL,
    jsonb_build_object('method', v_row.method, 'label', v_row.label, 'is_primary', true),
    jsonb_build_object('trigger', 'mkt007_4')
  );

  RETURN jsonb_build_object(
    'payment_method', to_jsonb(v_row),
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.set_agency_payment_method_primary(UUID, UUID, UUID) IS
  'MKT-007.4: marca un canal vigente y activo como primario de la agencia y baja al anterior. Valida actor, toma agency_payment_methods_lock_agency, audita agency_payment_method.primary_set. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.set_agency_payment_method_primary(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_agency_payment_method_primary(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.set_agency_payment_method_primary(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_agency_payment_method_primary(UUID, UUID, UUID) TO service_role;

-- ============================================================
-- 9) delete_agency_payment_method (borrado logico)
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_agency_payment_method(
  p_agency_id UUID,
  p_actor_user_id UUID,
  p_method_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_row public.agency_payment_methods%ROWTYPE;
  v_before JSONB;
  v_audit_id UUID;
BEGIN
  -- 1) Actor.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_ACTOR: Actor not found';
  END IF;

  SELECT u.* INTO v_actor
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_ACTOR: Actor not found';
  END IF;

  IF v_actor.role IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_ROLE: Only agency users can manage payment methods';
  END IF;

  IF v_actor.agency_id IS NULL
     OR v_actor.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_AGENCY: Payment method does not belong to this agency';
  END IF;

  IF p_method_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_NOT_FOUND: Payment method not found';
  END IF;

  -- 2) Bloqueo + regla de negocio.
  PERFORM public.agency_payment_methods_lock_agency(p_agency_id);

  -- 3) Canal vigente de ESTA agencia, con lock de fila.
  SELECT * INTO v_row
  FROM public.agency_payment_methods apm
  WHERE apm.id = p_method_id
    AND apm.agency_id = p_agency_id
    AND apm.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Idempotente: un canal ya borrado no es un error nuevo.
    SELECT * INTO v_row
    FROM public.agency_payment_methods apm
    WHERE apm.id = p_method_id
      AND apm.agency_id = p_agency_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'payment_method', to_jsonb(v_row),
        'already_deleted', true,
        'audit_id', NULL
      );
    END IF;

    RAISE EXCEPTION 'ERR_PAYMENT_METHOD_NOT_FOUND: Payment method not found';
  END IF;

  v_before := jsonb_build_object(
    'method', v_row.method,
    'label', v_row.label,
    'is_primary', v_row.is_primary,
    'is_active', v_row.is_active
  );

  -- 4) Borrado logico: baja is_active e is_primary; la fila se
  --    conserva porque los intentos referencian su snapshot
  --    (ON DELETE SET NULL solo aplica al borrado fisico).
  UPDATE public.agency_payment_methods apm
  SET deleted_at = NOW(),
      is_active = false,
      is_primary = false
  WHERE apm.id = p_method_id;

  SELECT * INTO v_row
  FROM public.agency_payment_methods apm
  WHERE apm.id = p_method_id;

  -- 5) Auditoria.
  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    p_agency_id,
    'agency_payment_method.deleted',
    'agency_payment_method',
    p_method_id,
    v_before,
    jsonb_build_object('deleted', true),
    jsonb_build_object('trigger', 'mkt007_4')
  );

  RETURN jsonb_build_object(
    'payment_method', to_jsonb(v_row),
    'already_deleted', false,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.delete_agency_payment_method(UUID, UUID, UUID) IS
  'MKT-007.4: borrado LOGICO de un canal (deleted_at + is_active false + is_primary false). La fila se conserva para los snapshots. Idempotente si ya estaba borrado. Valida actor, toma agency_payment_methods_lock_agency, audita agency_payment_method.deleted. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.delete_agency_payment_method(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_agency_payment_method(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.delete_agency_payment_method(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_agency_payment_method(UUID, UUID, UUID) TO service_role;

-- ============================================================
-- 10) select_checkout_payment_method
--     El cliente elige el canal ANTES de subir el comprobante.
--     Solo mientras status='created' y proof_count=0. Congela el
--     snapshot en la MISMA transaccion. Idempotente: re-elegir el
--     mismo canal devuelve el resultado sin escritura.
-- ============================================================

CREATE OR REPLACE FUNCTION public.select_checkout_payment_method(
  p_attempt_id UUID,
  p_customer_id UUID,
  p_payment_method_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_channel public.agency_payment_methods%ROWTYPE;
  v_snapshot JSONB;
  v_rowcount BIGINT;
BEGIN
  -- 1) Entrada.
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CUSTOMER_REQUIRED: An authenticated customer is required';
  END IF;
  IF p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ATTEMPT_NOT_FOUND: Checkout attempt not found';
  END IF;
  IF p_payment_method_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_PAYMENT_METHOD_INVALID: A payment method is required';
  END IF;

  -- 2) Intento con lock de fila (mismo orden que el resto del flujo).
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

  -- 3) Estado: el canal solo se elige ANTES del primer comprobante.
  IF v_attempt.status IN ('verified', 'rejected_final', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ATTEMPT_CLOSED: Checkout attempt is in status %', v_attempt.status;
  END IF;

  IF v_attempt.status = 'pending_review' OR v_attempt.proof_count >= 1 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_PAYMENT_METHOD_FROZEN: The payment method is frozen after the first proof submission';
  END IF;

  IF v_attempt.expires_at <= NOW() THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_WINDOW_EXPIRED: The checkout window has expired';
  END IF;

  -- 4) Canal: de ESTA agencia, activo y no borrado, con lock de fila.
  SELECT apm.*
    INTO v_channel
  FROM public.agency_payment_methods apm
  WHERE apm.id = p_payment_method_id
    AND apm.agency_id = v_attempt.agency_id
    AND apm.is_active
    AND apm.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_PAYMENT_METHOD_INVALID: Payment method is not available for this agency';
  END IF;

  -- 5) Idempotencia: mismo canal ya elegido devuelve sin escritura.
  IF v_attempt.payment_method_id IS NOT DISTINCT FROM v_channel.id
     AND v_attempt.payment_method_snapshot IS NOT NULL THEN
    RETURN jsonb_build_object(
      'attempt_id', v_attempt.id,
      'status', v_attempt.status,
      'amount_cents', v_attempt.amount_cents,
      'payment_method_id', v_attempt.payment_method_id,
      'payment_method_snapshot', v_attempt.payment_method_snapshot,
      'idempotent', true
    );
  END IF;

  -- 6) Snapshot inmutable del canal en el momento de elegirlo.
  v_snapshot := jsonb_build_object(
    'method', v_channel.method,
    'label', v_channel.label,
    'data', v_channel.data,
    'is_primary', v_channel.is_primary,
    'snapshot_version', 1,
    'selected_at', NOW()
  );

  UPDATE public.checkout_attempts ca
  SET payment_method_id = v_channel.id,
      payment_method_snapshot = v_snapshot,
      history = ca.history || jsonb_build_array(jsonb_build_object(
        'kind', 'payment_method',
        'payment_method_id', v_channel.id,
        'method', v_channel.method,
        'label', v_channel.label,
        'selected_at', NOW()
      ))
  WHERE ca.id = p_attempt_id;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount <> 1 THEN
    RAISE EXCEPTION 'ERR_CHECKOUT_ATTEMPT_NOT_FOUND: Checkout attempt not found';
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', p_attempt_id,
    'status', v_attempt.status,
    'amount_cents', v_attempt.amount_cents,
    'payment_method_id', v_channel.id,
    'payment_method_snapshot', v_snapshot,
    'idempotent', false
  );
END;
$$;

COMMENT ON FUNCTION public.select_checkout_payment_method(UUID, UUID, UUID) IS
  'MKT-007.4: el cliente elige su canal de pago para un checkout_attempt. Solo mientras status=created y proof_count=0 (con lock de fila); valida ownership y que el canal pertenezca a la agencia del intento, este activo y no borrado. Congela payment_method_id + payment_method_snapshot (copia inmutable) y appenda una entrada {kind:payment_method} al history. El trigger trg_checkout_attempts_protect_payment_method impide cambios posteriores. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.select_checkout_payment_method(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.select_checkout_payment_method(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.select_checkout_payment_method(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.select_checkout_payment_method(UUID, UUID, UUID) TO service_role;
