-- ============================================================
-- 091_agency_contacts.sql
-- MKT-008 Fase 1 - Contactos publicos de agencia.
--
-- Objetivo:
--   Dar a cada agencia un registro de numeros de contacto (llamada
--   o WhatsApp) que la agencia administra desde su propio panel,
--   con el formato de telefono del resto del sistema (11 digitos o
--   + y 12 digitos, sin asumir pais), visibilidad
--   configurable (publico/privado) y estado activo/inactivo.
--
-- Contexto (migraciones ya existentes, NO se modifican):
--   006/011 agencies.phone (telefono publico unico, legado; se
--       CONSERVA intacto como fallback de solo lectura).
--   041 agency_settings (solo branding; NO se reutiliza).
--   065 audit_append() y audit_log (actor guard: system|superadmin|
--       agency|customer).
--   089 agency_payment_methods (canales de pago; su data.phone es
--       el telefono del TITULAR de la cuenta de pago_movil, NO un
--       canal de contacto; NO se reutiliza).
--   087 checkout_attempts (intento de compra; NO se toca).
--
-- Modelo de datos:
--   agency_contacts: contactos configurados por la agencia.
--     phone TEXT CHECK formato del sistema: 0424xxxxxxx (11
--       digitos) o +58424xxxxxxx (+ y 12 digitos), sin conversion
--       0...->58...
--     channel TEXT CHECK (call | whatsapp) - canal del contacto.
--     is_public: si el contacto se publica a los clientes.
--     is_active: si el contacto esta vigente.
--     Borrado LOGICO (deleted_at), patron 089.
--
-- Aislamiento:
--   RLS habilitada, deny-by-default (sin policies); acceso solo
--   via service_role. Las RPC SECURITY DEFINER re-validan el actor
--   contra public.users (rol agency + ownership). agency_id NUNCA
--   llega del cliente: el backend lo deriva de req.ctx. No existe
--   RPC que permita cambiar agency_id de un contacto.
--
-- Sin efecto transaccional:
--   Estas RPC NO tocan reservas, asientos, checkout_attempts,
--   pagos ni locks. NO hay bloqueo tipo 089
--   (ERR_AGENCY_HAS_ACTIVE_CHECKOUTS): editar contactos nunca
--   bloquea ni libera compras.
--
-- Prohibido en esta migracion:
--   Editar 001-090; tocar agencies/agencies.phone; tocar
--   agency_payment_methods; tocar RPCs de 087/089; tocar TTLs
--   (Tour 600 s / Marketplace 900 s); policies publicas de lectura
--   (la exposicion al Marketplace llega en fase posterior via
--   backend service_role); BEGIN/COMMIT; SQL de rollback.
--
-- Orden de migraciones (dato local, no se asume aplicado en remoto):
--   091 es la siguiente numeracion libre tras 090.
--
-- Dry-run:   BEGIN;  \i 091_agency_contacts.sql   ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) audit_log: ampliacion ADITIVA de CHECKs (patron guard de 086
--    y 087/089). Acciones nuevas: agency_contact.created /
--    .updated / .deleted. Entidad nueva: agency_contact.
--    audit_log_actor_check NO se toca.
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
    'agency_payment_method.deleted',
    'agency_contact.created',
    'agency_contact.updated',
    'agency_contact.deleted'
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
        RAISE EXCEPTION 'ERR_091_ACTION_GUARD: audit_log_action_check contiene la accion "%" que 091 no conoce. Una migracion posterior agrego valores; mergear manualmente antes de aplicar 091.', v_lit;
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
      'agency_payment_method.deleted',
      'agency_contact.created',
      'agency_contact.updated',
      'agency_contact.deleted'
    )
  );

COMMENT ON CONSTRAINT audit_log_action_check ON public.audit_log IS
  '065 + 069 + 079 (16) + 086 payment (2) + 087 checkout (4) + 089 agency_payment_method (4) + 091 agency_contact (3). Aditivo: no quitar valores.';

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
    'agency_payment_method',
    'agency_contact'
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
        RAISE EXCEPTION 'ERR_091_ENTITY_GUARD: audit_log_entity_type_check contiene el valor "%" que 091 no conoce. Una migracion posterior agrego valores; mergear manualmente antes de aplicar 091.', v_lit;
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
      'agency_payment_method',
      'agency_contact'
    )
  );

COMMENT ON CONSTRAINT audit_log_entity_type_check ON public.audit_log IS
  '065 + 069 (6) + 086 payment (1) + 087 checkout_attempt (1) + 089 agency_payment_method (1) + 091 agency_contact (1). Aditivo: no quitar valores.';

-- ============================================================
-- 2) Tabla agency_contacts
-- ============================================================

CREATE TABLE public.agency_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  phone TEXT NOT NULL CHECK (phone ~ '^([0-9]{11}|\+[0-9]{12})$'),
  channel TEXT NOT NULL CHECK (channel IN ('call', 'whatsapp')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_public BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Un unico numero por agencia entre filas vivas (evita duplicados).
CREATE UNIQUE INDEX uq_agency_contacts_phone
  ON public.agency_contacts (agency_id, phone)
  WHERE deleted_at IS NULL;

-- Listado por agencia: solo vivos, activos/publicos primero.
CREATE INDEX idx_agency_contacts_agency
  ON public.agency_contacts (agency_id, is_active, is_public, sort_order, created_at)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.agency_contacts IS
  'MKT-008: numeros de contacto (llamada/WhatsApp) administrados por la agencia desde su panel. Formato del sistema (11 digitos o + y 12 digitos), sin asumir pais. Borrado logico (deleted_at).';
COMMENT ON COLUMN public.agency_contacts.phone IS
  'MKT-008: numero en formato del sistema: 11 digitos nacionales (0424xxxxxxx) o + con 12 digitos (+58424xxxxxxx), identico a lib/reservations/validateForm.ts. Validado en RPC con agency_contact_normalize_phone. NO se convierte 0... a 58...';
COMMENT ON COLUMN public.agency_contacts.channel IS
  'MKT-008: canal del contacto (call = llamada, whatsapp = WhatsApp). No asume WhatsApp.';
COMMENT ON COLUMN public.agency_contacts.is_public IS
  'MKT-008: si el contacto se publica a los clientes del marketplace. Por defecto false (borrador privado hasta que la agencia lo publique).';
COMMENT ON COLUMN public.agency_contacts.deleted_at IS
  'MKT-008: borrado logico. El contacto deja de listarse y de publicarse; la fila se conserva como historico.';

ALTER TABLE public.agency_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agency_contacts FROM PUBLIC;
REVOKE ALL ON TABLE public.agency_contacts FROM anon;
REVOKE ALL ON TABLE public.agency_contacts FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agency_contacts TO service_role;

CREATE TRIGGER agency_contacts_updated_t
  BEFORE UPDATE ON public.agency_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 3) Normalizacion y validacion del formato del sistema. Defensa en
--    profundidad: el backend ya valida con Zod (mismo patron de
--    regex); aqui se protege lo que se persiste. NO convierte
--    0... -> 58... (el formato nacional se acepta tal cual).
-- ============================================================

CREATE OR REPLACE FUNCTION public.agency_contact_normalize_phone(
  p_phone TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v TEXT;
BEGIN
  v := NULLIF(btrim(COALESCE(p_phone, '')), '');
  IF v IS NULL THEN
    RAISE EXCEPTION 'ERR_CONTACT_DATA: phone is required';
  END IF;

  -- Quitar separadores de presentacion (mismo strip que
  -- PHONE_STRIP_RE de lib/reservations/validateForm.ts: espacios y
  -- guiones).
  v := regexp_replace(v, '[\s\-]', '', 'g');

  -- Formato del sistema: 11 digitos nacionales (0424xxxxxxx) o +
  -- con 12 digitos (+58424xxxxxxx). NO convierte 0... -> 58...
  -- (el formato nacional se acepta tal cual).
  IF v !~ '^([0-9]{11}|\+[0-9]{12})$' THEN
    RAISE EXCEPTION 'ERR_CONTACT_DATA: phone must match 0424xxxxxxx or +58424xxxxxxx (11 digits, or + and 12 digits)';
  END IF;

  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.agency_contact_normalize_phone(TEXT) IS
  'MKT-008: normaliza y valida un telefono de contacto en el formato del sistema (11 digitos, o + y 12 digitos). Quita separadores de presentacion (espacios y guiones). NO convierte 0... a 58... ni 00 a +. Lanza ERR_CONTACT_DATA. Solo la invocan las RPC de esta migracion.';

REVOKE ALL ON FUNCTION public.agency_contact_normalize_phone(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agency_contact_normalize_phone(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.agency_contact_normalize_phone(TEXT) FROM authenticated;

-- ============================================================
-- 4) create_agency_contact
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_agency_contact(
  p_agency_id UUID,
  p_actor_user_id UUID,
  p_label TEXT,
  p_phone TEXT,
  p_channel TEXT,
  p_is_public BOOLEAN,
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
  v_phone TEXT;
  v_new_id UUID;
  v_row public.agency_contacts%ROWTYPE;
  v_audit_id UUID;
BEGIN
  -- 1) Actor: agency con ownership de la agencia. agency_id NUNCA
  --    llega del cliente; se resuelve del registro public.users.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CONTACT_ACTOR: Actor not found';
  END IF;

  SELECT u.* INTO v_actor
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_CONTACT_ACTOR: Actor not found';
  END IF;

  IF v_actor.role IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION 'ERR_CONTACT_ROLE: Only agency users can manage contacts';
  END IF;

  IF v_actor.agency_id IS NULL
     OR v_actor.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_CONTACT_AGENCY: Contact does not belong to this agency';
  END IF;

  -- 2) Entrada.
  v_label := NULLIF(btrim(COALESCE(p_label, '')), '');
  IF v_label IS NULL OR length(v_label) > 60 THEN
    RAISE EXCEPTION 'ERR_CONTACT_DATA: label is required (max 60 chars)';
  END IF;

  IF p_channel IS NULL OR p_channel NOT IN ('call', 'whatsapp') THEN
    RAISE EXCEPTION 'ERR_CONTACT_DATA: channel must be call or whatsapp';
  END IF;

  v_phone := public.agency_contact_normalize_phone(p_phone);

  -- 3) INSERT con deteccion de duplicado (indice parcial unico).
  BEGIN
    INSERT INTO public.agency_contacts (
      agency_id, label, phone, channel, is_active, is_public, sort_order
    ) VALUES (
      p_agency_id, v_label, v_phone, p_channel, true,
      COALESCE(p_is_public, false), COALESCE(p_sort_order, 0)
    )
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_CONTACT_DUPLICATE: This phone number already exists for the agency';
  END;

  SELECT * INTO v_row
  FROM public.agency_contacts ac
  WHERE ac.id = v_new_id;

  -- 4) Auditoria (actor 'agency', acciones 091).
  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    p_agency_id,
    'agency_contact.created',
    'agency_contact',
    v_new_id,
    NULL,
    jsonb_build_object(
      'label', v_row.label,
      'phone', v_row.phone,
      'channel', v_row.channel,
      'is_public', v_row.is_public,
      'is_active', v_row.is_active
    ),
    jsonb_build_object('trigger', 'mkt008')
  );

  RETURN jsonb_build_object(
    'contact', to_jsonb(v_row),
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.create_agency_contact(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER) IS
  'MKT-008: crea un contacto de la agencia (label, telefono en formato del sistema, canal call|whatsapp, publico/privado). Valida actor agency con ownership via public.users, normaliza el telefono, rechaza duplicados vivos (ERR_CONTACT_DUPLICATE) y audita agency_contact.created. NO toca reservas, asientos ni locks. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.create_agency_contact(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_agency_contact(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.create_agency_contact(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_agency_contact(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER) TO service_role;

-- ============================================================
-- 5) update_agency_contact
--    NULL en label/phone/channel/is_public/sort_order/is_active
--    significa "no cambiar". agency_id es inmutable: la funcion no
--    lo acepta ni lo escribe.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_agency_contact(
  p_agency_id UUID,
  p_actor_user_id UUID,
  p_contact_id UUID,
  p_label TEXT,
  p_phone TEXT,
  p_channel TEXT,
  p_is_public BOOLEAN,
  p_sort_order INTEGER,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_row public.agency_contacts%ROWTYPE;
  v_before JSONB;
  v_label TEXT;
  v_phone TEXT;
  v_audit_id UUID;
BEGIN
  -- 1) Actor.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CONTACT_ACTOR: Actor not found';
  END IF;

  SELECT u.* INTO v_actor
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_CONTACT_ACTOR: Actor not found';
  END IF;

  IF v_actor.role IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION 'ERR_CONTACT_ROLE: Only agency users can manage contacts';
  END IF;

  IF v_actor.agency_id IS NULL
     OR v_actor.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_CONTACT_AGENCY: Contact does not belong to this agency';
  END IF;

  IF p_contact_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CONTACT_NOT_FOUND: Contact not found';
  END IF;

  -- 2) Contacto vigente de ESTA agencia, con lock de fila.
  SELECT * INTO v_row
  FROM public.agency_contacts ac
  WHERE ac.id = p_contact_id
    AND ac.agency_id = p_agency_id
    AND ac.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_CONTACT_NOT_FOUND: Contact not found';
  END IF;

  v_before := jsonb_build_object(
    'label', v_row.label,
    'phone', v_row.phone,
    'channel', v_row.channel,
    'is_public', v_row.is_public,
    'is_active', v_row.is_active,
    'sort_order', v_row.sort_order
  );

  -- 3) Entrada: solo los campos enviados cambian.
  IF p_label IS NOT NULL THEN
    v_label := NULLIF(btrim(p_label), '');
    IF v_label IS NULL OR length(v_label) > 60 THEN
      RAISE EXCEPTION 'ERR_CONTACT_DATA: label is required (max 60 chars)';
    END IF;
  END IF;

  IF p_phone IS NOT NULL THEN
    v_phone := public.agency_contact_normalize_phone(p_phone);
  END IF;

  IF p_channel IS NOT NULL AND p_channel NOT IN ('call', 'whatsapp') THEN
    RAISE EXCEPTION 'ERR_CONTACT_DATA: channel must be call or whatsapp';
  END IF;

  -- 4) UPDATE. agency_id NO se modifica. Duplicado -> ERR_CONTACT_DUPLICATE.
  BEGIN
    UPDATE public.agency_contacts ac
    SET label = COALESCE(v_label, ac.label),
        phone = COALESCE(v_phone, ac.phone),
        channel = COALESCE(p_channel, ac.channel),
        is_public = COALESCE(p_is_public, ac.is_public),
        is_active = COALESCE(p_is_active, ac.is_active),
        sort_order = COALESCE(p_sort_order, ac.sort_order)
    WHERE ac.id = p_contact_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ERR_CONTACT_DUPLICATE: This phone number already exists for the agency';
  END;

  SELECT * INTO v_row
  FROM public.agency_contacts ac
  WHERE ac.id = p_contact_id;

  -- 5) Auditoria.
  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    p_agency_id,
    'agency_contact.updated',
    'agency_contact',
    p_contact_id,
    v_before,
    jsonb_build_object(
      'label', v_row.label,
      'phone', v_row.phone,
      'channel', v_row.channel,
      'is_public', v_row.is_public,
      'is_active', v_row.is_active,
      'sort_order', v_row.sort_order
    ),
    jsonb_build_object('trigger', 'mkt008')
  );

  RETURN jsonb_build_object(
    'contact', to_jsonb(v_row),
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.update_agency_contact(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, BOOLEAN) IS
  'MKT-008: actualiza label/phone/channel/is_public/sort_order/is_active de un contacto vigente de la agencia (NULL = no cambiar). agency_id es inmutable. Valida actor agency con ownership, rechaza duplicados vivos, audita agency_contact.updated. NO toca reservas, asientos ni locks. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.update_agency_contact(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_agency_contact(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.update_agency_contact(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_agency_contact(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, BOOLEAN) TO service_role;

-- ============================================================
-- 6) delete_agency_contact (borrado logico, idempotente)
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_agency_contact(
  p_agency_id UUID,
  p_actor_user_id UUID,
  p_contact_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_row public.agency_contacts%ROWTYPE;
  v_before JSONB;
  v_audit_id UUID;
BEGIN
  -- 1) Actor.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CONTACT_ACTOR: Actor not found';
  END IF;

  SELECT u.* INTO v_actor
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_CONTACT_ACTOR: Actor not found';
  END IF;

  IF v_actor.role IS DISTINCT FROM 'agency' THEN
    RAISE EXCEPTION 'ERR_CONTACT_ROLE: Only agency users can manage contacts';
  END IF;

  IF v_actor.agency_id IS NULL
     OR v_actor.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_CONTACT_AGENCY: Contact does not belong to this agency';
  END IF;

  IF p_contact_id IS NULL THEN
    RAISE EXCEPTION 'ERR_CONTACT_NOT_FOUND: Contact not found';
  END IF;

  -- 2) Contacto vigente de ESTA agencia, con lock de fila.
  SELECT * INTO v_row
  FROM public.agency_contacts ac
  WHERE ac.id = p_contact_id
    AND ac.agency_id = p_agency_id
    AND ac.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Idempotente: un contacto ya borrado no es un error nuevo.
    SELECT * INTO v_row
    FROM public.agency_contacts ac
    WHERE ac.id = p_contact_id
      AND ac.agency_id = p_agency_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'contact', to_jsonb(v_row),
        'already_deleted', true,
        'audit_id', NULL
      );
    END IF;

    RAISE EXCEPTION 'ERR_CONTACT_NOT_FOUND: Contact not found';
  END IF;

  v_before := jsonb_build_object(
    'label', v_row.label,
    'phone', v_row.phone,
    'channel', v_row.channel,
    'is_public', v_row.is_public,
    'is_active', v_row.is_active,
    'sort_order', v_row.sort_order
  );

  -- 3) Borrado logico: baja is_active; la fila se conserva.
  UPDATE public.agency_contacts ac
  SET deleted_at = NOW(),
      is_active = false
  WHERE ac.id = p_contact_id;

  SELECT * INTO v_row
  FROM public.agency_contacts ac
  WHERE ac.id = p_contact_id;

  -- 4) Auditoria.
  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    p_agency_id,
    'agency_contact.deleted',
    'agency_contact',
    p_contact_id,
    v_before,
    jsonb_build_object('deleted', true),
    jsonb_build_object('trigger', 'mkt008')
  );

  RETURN jsonb_build_object(
    'contact', to_jsonb(v_row),
    'already_deleted', false,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.delete_agency_contact(UUID, UUID, UUID) IS
  'MKT-008: borrado LOGICO de un contacto (deleted_at + is_active false). Idempotente si ya estaba borrado. Valida actor agency con ownership, audita agency_contact.deleted. NO toca reservas, asientos ni locks. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.delete_agency_contact(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_agency_contact(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.delete_agency_contact(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_agency_contact(UUID, UUID, UUID) TO service_role;
