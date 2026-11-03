-- ============================================================
-- 099_trip_agency_reviews.sql
-- REV-001 — Reseñas de viaje y de agencia + envio atomico + moderacion.
--
-- Contexto:
--   097 agrego trips.completed_at (base de la ventana de 48 h) y 098
--   las invitaciones (review_requests) + notificaciones de cliente.
--   Este entrego persiste las DOS reseñas que una reserva requiere
--   (viaje y agencia), su envio ATOMICO y la moderacion por
--   superadmin, todo auditado.
--
-- Reglas de negocio (REV-001, decisiones autoritativas):
--   * Solo el cliente dueño de la reserva marketplace puede reseñar.
--   * UNA reseña de viaje + UNA de agencia por reserva, obligatorias y
--     enviadas JUNTAS en UNA sola transaccion (sin envios parciales).
--   * Rating entero 1..5. Comentario opcional.
--   * El cliente NO puede editar ni borrar lo enviado; las correcciones
--     las hace el superadmin (hide/reject/restore) via RPC auditada.
--   * Publicacion inmediata (moderation_status='visible') salvo
--     moderacion posterior.
--   * Elegibilidad: viaje completado (trips.status='completed') y
--     dentro de la ventana (trips.completed_at + 48 h). Reservation
--     confirmada (excluye locked y cancelled); reembolsada pero NO
--     cancelada sigue siendo elegible.
--   * La coherencia reservation+trip+customer+agency esta garantizada
--     por FK compuesta (098) Y por valores derivados en el servidor
--     dentro de la RPC (nunca se confia el cliente en los ids).
--
-- audit_log:
--   Ampliacion ADITIVA de los CHECK (patron guard de 069/079/086/087/089/091):
--   acciones + review.created / review.moderated; entidades +
--   trip_review / agency_review. Nada se quita. actor_check NO se toca
--   (079 ya admite 'customer'). La auditoria de creacion usa INSERT
--   directo porque audit_append() rechaza actor 'customer' (065).
--
-- Prohibido en esta migracion:
--   Editar migraciones historicas; tocar RPCs de tour; tocar el actor
--   check; BEGIN/COMMIT; SQL de rollback.
--
-- Dry-run:   BEGIN;  \i 099_trip_agency_reviews.sql   ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) audit_log: ampliacion ADITIVA de CHECK (patron guard de 087/089/091).
--    El estado VIVO previo a 099 lo define 091 (29 acciones / 10
--    entidades: 087 + 089 agency_payment_method + 091 agency_contact);
--    099 solo AGREGA review.created/review.moderated y
--    trip_review/agency_review. Se coloca ANTES de las tablas/RPC para
--    que cualquier fila escrita por las funciones nuevas ya satisfaga
--    los constraints.
-- ============================================================

-- 1a) Guard de acciones: falla con ruido si el CHECK vigente contiene
--     una accion que 099 no conoce (migracion posterior a 091).
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
        RAISE EXCEPTION 'ERR_099_ACTION_GUARD: audit_log_action_check contiene la accion "%" que 099 no conoce. Una migracion posterior agrego valores; mergear manualmente antes de aplicar 099.', v_lit;
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
      'agency_contact.deleted',
      'review.created',
      'review.moderated'
    )
  );

COMMENT ON CONSTRAINT audit_log_action_check ON public.audit_log IS
  '065 + 069 + 079 (16) + 086 payment (2) + 087 checkout (4) + 089 agency_payment_method (4) + 091 agency_contact (3) + 099 review (2). Aditivo: no quitar valores.';

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
    'agency_contact',
    'trip_review',
    'agency_review'
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
        RAISE EXCEPTION 'ERR_099_ENTITY_GUARD: audit_log_entity_type_check contiene el valor "%" que 099 no conoce. Una migracion posterior agrego valores; mergear manualmente antes de aplicar 099.', v_lit;
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
      'agency_contact',
      'trip_review',
      'agency_review'
    )
  );

COMMENT ON CONSTRAINT audit_log_entity_type_check ON public.audit_log IS
  '065 + 069 (6) + 086 payment (1) + 087 checkout_attempt (1) + 089 agency_payment_method (1) + 091 agency_contact (1) + 099 trip_review/agency_review (2). Aditivo: no quitar valores.';

-- ============================================================
-- 2) Tablas de reseñas. Una por reserva cada una (UNIQUE sobre
--    reservation_id). Coherencia garantizada por FK compuesta.
-- ============================================================

CREATE TABLE public.trip_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  reservation_id UUID NOT NULL
    UNIQUE
    REFERENCES public.reservations(id) ON DELETE CASCADE,

  trip_id UUID NOT NULL,
  customer_id UUID NOT NULL,

  rating INTEGER NOT NULL
    CHECK (rating >= 1 AND rating <= 5),

  -- Comentario opcional; largo acotado. NULL si se envia vacio.
  comment TEXT
    CHECK (comment IS NULL OR char_length(comment) <= 2000),

  moderation_status TEXT NOT NULL DEFAULT 'visible'
    CHECK (moderation_status IN ('visible', 'hidden', 'rejected')),

  moderated_by UUID NULL REFERENCES public.users(id),
  moderated_at TIMESTAMPTZ NULL,
  moderation_reason TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Moderacion coherente: si hay quien/modo, hay marca temporal.
  CONSTRAINT trip_reviews_moderation_fields_check CHECK (
    (moderated_by IS NOT NULL AND moderated_at IS NOT NULL)
    OR (moderated_by IS NULL AND moderated_at IS NULL)
  ),

  -- Coherencia reservation+trip y reservation+customer por esquema.
  FOREIGN KEY (reservation_id, trip_id)
    REFERENCES public.reservations(id, trip_id),
  FOREIGN KEY (reservation_id, customer_id)
    REFERENCES public.reservations(id, customer_id)
);

COMMENT ON TABLE public.trip_reviews IS
  'REV-001: reseña del VIAJE para una reserva marketplace. UNA por reserva (UNIQUE reservation_id). Rating 1..5, comentario opcional. El cliente no edita/borra; modera el superadmin. Coherencia reservation+trip+customer por FK compuesta.';

CREATE TABLE public.agency_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  reservation_id UUID NOT NULL
    UNIQUE
    REFERENCES public.reservations(id) ON DELETE CASCADE,

  -- La agencia reseñada es la de la RESERVA (reservations.agency_id),
  -- no necesariamente la unica del viaje.
  agency_id UUID NOT NULL,
  trip_id UUID NOT NULL,
  customer_id UUID NOT NULL,

  rating INTEGER NOT NULL
    CHECK (rating >= 1 AND rating <= 5),

  comment TEXT
    CHECK (comment IS NULL OR char_length(comment) <= 2000),

  moderation_status TEXT NOT NULL DEFAULT 'visible'
    CHECK (moderation_status IN ('visible', 'hidden', 'rejected')),

  moderated_by UUID NULL REFERENCES public.users(id),
  moderated_at TIMESTAMPTZ NULL,
  moderation_reason TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT agency_reviews_moderation_fields_check CHECK (
    (moderated_by IS NOT NULL AND moderated_at IS NOT NULL)
    OR (moderated_by IS NULL AND moderated_at IS NULL)
  ),

  -- Coherencia reservation+agency, +trip y +customer por esquema.
  FOREIGN KEY (reservation_id, agency_id)
    REFERENCES public.reservations(id, agency_id),
  FOREIGN KEY (reservation_id, trip_id)
    REFERENCES public.reservations(id, trip_id),
  FOREIGN KEY (reservation_id, customer_id)
    REFERENCES public.reservations(id, customer_id)
);

COMMENT ON TABLE public.agency_reviews IS
  'REV-001: reseña de la AGENCIA responsable de la reserva (reservations.agency_id). UNA por reserva (UNIQUE reservation_id). Rating 1..5, comentario opcional. El cliente no edita/borra; modera el superadmin. Coherencia reservation+agency+trip+customer por FK compuesta.';

CREATE INDEX IF NOT EXISTS idx_trip_reviews_trip_rating
  ON public.trip_reviews (trip_id, rating)
  WHERE moderation_status = 'visible';
CREATE INDEX IF NOT EXISTS idx_agency_reviews_agency_rating
  ON public.agency_reviews (agency_id, rating)
  WHERE moderation_status = 'visible';
CREATE INDEX IF NOT EXISTS idx_trip_reviews_customer
  ON public.trip_reviews (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_reviews_customer
  ON public.agency_reviews (customer_id, created_at DESC);

CREATE TRIGGER trip_reviews_updated_t
  BEFORE UPDATE ON public.trip_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER agency_reviews_updated_t
  BEFORE UPDATE ON public.agency_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 3) RLS de las reseñas.
--    Cliente: LEE las suyas (propias). NO inserta, NO actualiza, NO
--    borra (el envio y la moderacion pasan por RPC service_role).
--    Publico: puede leer solo las VISIBLES (futuras paginas de
--    reputacion). superadmin: todo.
-- ============================================================

ALTER TABLE public.trip_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_reviews ENABLE ROW LEVEL SECURITY;

-- Cliente lee las suyas.
DROP POLICY IF EXISTS "trip_reviews_customer_read" ON public.trip_reviews;
CREATE POLICY "trip_reviews_customer_read" ON public.trip_reviews
  FOR SELECT USING (customer_id = auth.uid());

DROP POLICY IF EXISTS "agency_reviews_customer_read" ON public.agency_reviews;
CREATE POLICY "agency_reviews_customer_read" ON public.agency_reviews
  FOR SELECT USING (customer_id = auth.uid());

-- Lectura publica de las visibles (solo VISIBLES; hidden/rejected no).
DROP POLICY IF EXISTS "trip_reviews_public_visible_read" ON public.trip_reviews;
CREATE POLICY "trip_reviews_public_visible_read" ON public.trip_reviews
  FOR SELECT USING (moderation_status = 'visible');

DROP POLICY IF EXISTS "agency_reviews_public_visible_read" ON public.agency_reviews;
CREATE POLICY "agency_reviews_public_visible_read" ON public.agency_reviews
  FOR SELECT USING (moderation_status = 'visible');

-- superadmin todo (panel de moderacion).
DROP POLICY IF EXISTS "trip_reviews_superadmin_all" ON public.trip_reviews;
CREATE POLICY "trip_reviews_superadmin_all" ON public.trip_reviews
  FOR ALL USING ((SELECT private.auth_app_role()) = 'superadmin');

DROP POLICY IF EXISTS "agency_reviews_superadmin_all" ON public.agency_reviews;
CREATE POLICY "agency_reviews_superadmin_all" ON public.agency_reviews
  FOR ALL USING ((SELECT private.auth_app_role()) = 'superadmin');

-- Escritura: solo service_role (deny-by-default: sin policy de INSERT
-- para authenticated/anon). El cliente JAMAS escribe directamente.
REVOKE ALL ON TABLE public.trip_reviews FROM PUBLIC;
REVOKE ALL ON TABLE public.trip_reviews FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.trip_reviews FROM authenticated;

REVOKE ALL ON TABLE public.agency_reviews FROM PUBLIC;
REVOKE ALL ON TABLE public.agency_reviews FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.agency_reviews FROM authenticated;

-- ============================================================
-- 4) submit_reservation_reviews — envio ATOMICO de las DOS reseñas.
--    Valida TODO en el servidor (dueno, reserva, viaje, ventana,
--    invitation) y escribe ambas reseñas + invitation completada +
--    dos filas de auditoria en UNA sola transaccion. Idempotente: si
--    ya existen las dos reseñas de la reserva para este cliente, las
--    devuelve sin reescribir (reintentos seguros).
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_reservation_reviews(
  p_reservation_id UUID,
  p_customer_id UUID,
  p_trip_rating INTEGER,
  p_trip_comment TEXT,
  p_agency_rating INTEGER,
  p_agency_comment TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_trip public.trips%ROWTYPE;
  v_request public.review_requests%ROWTYPE;
  v_request_found BOOLEAN := FALSE;
  v_trip_comment TEXT;
  v_agency_comment TEXT;
  v_trip_review_id UUID;
  v_agency_review_id UUID;
  v_existing_trip_id UUID;
  v_existing_agency_id UUID;
  v_window CONSTANT INTERVAL := interval '48 hours';
BEGIN
  -- 1) Entrada basica.
  IF p_reservation_id IS NULL OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REVIEW_INPUT: reservation and customer are required';
  END IF;
  IF p_trip_rating IS NULL OR p_trip_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'ERR_REVIEW_RATING: trip rating must be an integer between 1 and 5';
  END IF;
  IF p_agency_rating IS NULL OR p_agency_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'ERR_REVIEW_RATING: agency rating must be an integer between 1 and 5';
  END IF;

  -- Comentarios: opcionales; vacio -> NULL; largo acotado.
  v_trip_comment := NULLIF(btrim(COALESCE(p_trip_comment, '')), '');
  v_agency_comment := NULLIF(btrim(COALESCE(p_agency_comment, '')), '');
  IF v_trip_comment IS NOT NULL AND char_length(v_trip_comment) > 2000 THEN
    RAISE EXCEPTION 'ERR_REVIEW_COMMENT: trip comment is too long (max 2000)';
  END IF;
  IF v_agency_comment IS NOT NULL AND char_length(v_agency_comment) > 2000 THEN
    RAISE EXCEPTION 'ERR_REVIEW_COMMENT: agency comment is too long (max 2000)';
  END IF;

  -- 2) Reserva con FOR UPDATE: serializa envios concurrentes.
  SELECT r.* INTO v_reservation
  FROM public.reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_REVIEW_RESERVATION_NOT_FOUND: Reservation not found';
  END IF;

  -- 3) Ownership y fuente: SIEMPRE del servidor, nunca del cliente.
  IF v_reservation.customer_id IS NULL
     OR v_reservation.customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'ERR_REVIEW_NOT_OWNER: Reservation does not belong to this customer';
  END IF;

  IF v_reservation.source IS DISTINCT FROM 'marketplace' THEN
    RAISE EXCEPTION 'ERR_REVIEW_NOT_ELIGIBLE: Only marketplace reservations can be reviewed';
  END IF;

  -- 4) Idempotencia por reserva: si ya existen las DOS reseñas de
  --    ESTA reserva para ESTE cliente, devolverlas sin reescribir.
  --    Se evalua ANTES de los chequeos de viaje/ventana para que un
  --    reintento tardio (tras cerrar la ventana) devuelva
  --    already_submitted y no un falso WINDOW_EXPIRED.
  SELECT tr.id INTO v_existing_trip_id
  FROM public.trip_reviews tr
  WHERE tr.reservation_id = p_reservation_id
    AND tr.customer_id = p_customer_id;

  IF FOUND THEN
    SELECT ar.id INTO v_existing_agency_id
    FROM public.agency_reviews ar
    WHERE ar.reservation_id = p_reservation_id
      AND ar.customer_id = p_customer_id;

    RETURN jsonb_build_object(
      'reservation_id', p_reservation_id,
      'already_submitted', true,
      'trip_review_id', v_existing_trip_id,
      'agency_review_id', v_existing_agency_id
    );
  END IF;

  -- 5) Confirmada: excluye locked y cancelled. Reembolsada pero no
  --    cancelada sigue siendo elegible (no se mira payment_status).
  IF v_reservation.status IN ('locked', 'cancelled') THEN
    RAISE EXCEPTION 'ERR_REVIEW_NOT_ELIGIBLE: Reservation is not confirmed';
  END IF;

  IF v_reservation.agency_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REVIEW_NOT_ELIGIBLE: Reservation has no agency';
  END IF;

  -- 6) Viaje completado + dentro de la ventana.
  SELECT t.* INTO v_trip
  FROM public.trips t
  WHERE t.id = v_reservation.trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_REVIEW_TRIP_NOT_FOUND: Trip not found';
  END IF;

  IF v_trip.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'ERR_REVIEW_TRIP_NOT_COMPLETED: Trip is not completed';
  END IF;

  IF v_trip.completed_at IS NULL THEN
    RAISE EXCEPTION 'ERR_REVIEW_NO_COMPLETION_TIMESTAMP: Trip has no completion timestamp';
  END IF;

  IF v_trip.completed_at + v_window <= NOW() THEN
    RAISE EXCEPTION 'ERR_REVIEW_WINDOW_EXPIRED: The review window has expired';
  END IF;

  -- 7) Invitation (si existe) pendiente y no vencida. La expiracion
  --    es la autoridad de 098; aqui se respeta.
  SELECT rr.* INTO v_request
  FROM public.review_requests rr
  WHERE rr.reservation_id = p_reservation_id
  FOR UPDATE;

  v_request_found := FOUND;

  IF v_request_found AND v_request.status = 'expired' THEN
    RAISE EXCEPTION 'ERR_REVIEW_INVITATION_EXPIRED: The review invitation has expired';
  END IF;

  IF v_request_found AND v_request.expires_at <= NOW() THEN
    RAISE EXCEPTION 'ERR_REVIEW_INVITATION_EXPIRED: The review invitation has expired';
  END IF;

  -- 8) Insertar las DOS reseñas con valores derivados del SERVIDOR
  --    (trip_id/agency_id/customer_id salen de la reserva, jamas del
  --    cliente). La coherencia es ademas reforzada por FK compuesta.
  INSERT INTO public.trip_reviews (
    reservation_id, trip_id, customer_id, rating, comment
  ) VALUES (
    p_reservation_id, v_reservation.trip_id, v_reservation.customer_id,
    p_trip_rating, v_trip_comment
  )
  RETURNING id INTO v_trip_review_id;

  INSERT INTO public.agency_reviews (
    reservation_id, agency_id, trip_id, customer_id, rating, comment
  ) VALUES (
    p_reservation_id, v_reservation.agency_id, v_reservation.trip_id,
    v_reservation.customer_id, p_agency_rating, v_agency_comment
  )
  RETURNING id INTO v_agency_review_id;

  -- 9) Invitation completada (si existia).
  IF v_request_found THEN
    UPDATE public.review_requests
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = v_request.id;
  END IF;

  -- 10) Auditoria ATOMICA (dos filas: una por entidad). Actor
  --     'customer': audit_append() lo rechaza (065), por lo que se
  --     INSERTa directo (patron de 079/087); el CHECK actor ya admite
  --     'customer' desde 079.
  INSERT INTO public.audit_log (
    actor_user_id, actor_role, agency_id,
    action, entity_type, entity_id, before, after, metadata
  ) VALUES (
    v_reservation.customer_id, 'customer', v_reservation.agency_id,
    'review.created', 'trip_review', v_trip_review_id,
    NULL,
    jsonb_build_object(
      'reservation_id', p_reservation_id,
      'rating', p_trip_rating,
      'moderation_status', 'visible'
    ),
    jsonb_build_object(
      'agency_review_id', v_agency_review_id,
      'trigger', 'submit_reservation_reviews'
    )
  );

  INSERT INTO public.audit_log (
    actor_user_id, actor_role, agency_id,
    action, entity_type, entity_id, before, after, metadata
  ) VALUES (
    v_reservation.customer_id, 'customer', v_reservation.agency_id,
    'review.created', 'agency_review', v_agency_review_id,
    NULL,
    jsonb_build_object(
      'reservation_id', p_reservation_id,
      'rating', p_agency_rating,
      'moderation_status', 'visible'
    ),
    jsonb_build_object(
      'trip_review_id', v_trip_review_id,
      'trigger', 'submit_reservation_reviews'
    )
  );

  RETURN jsonb_build_object(
    'reservation_id', p_reservation_id,
    'already_submitted', false,
    'trip_review_id', v_trip_review_id,
    'agency_review_id', v_agency_review_id
  );
END;
$$;

COMMENT ON FUNCTION public.submit_reservation_reviews(UUID, UUID, INTEGER, TEXT, INTEGER, TEXT) IS
  'REV-001: envio ATOMICO de las DOS reseñas (viaje + agencia) de una reserva marketplace, en UNA transaccion. Valida en el servidor dueno, fuente, estado confirmado, viaje completado dentro de la ventana (trips.completed_at + 48 h) y invitation no vencida. Inserta ambas reseñas + completa la invitation + dos auditorias. Idempotente por reserva. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.submit_reservation_reviews(UUID, UUID, INTEGER, TEXT, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_reservation_reviews(UUID, UUID, INTEGER, TEXT, INTEGER, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.submit_reservation_reviews(UUID, UUID, INTEGER, TEXT, INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_reservation_reviews(UUID, UUID, INTEGER, TEXT, INTEGER, TEXT) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.submit_reservation_reviews(UUID, UUID, INTEGER, TEXT, INTEGER, TEXT) OWNER TO postgres;
  END IF;
END $$;

-- ============================================================
-- 5) moderate_review — moderacion ATOMICA + auditada por superadmin.
--    Acciones: hide (ocultar), reject (rechazar), restore (volver a
--    visible, para correccion administrativa). El cliente jamas la
--    invoca; el actor debe ser superadmin (validado aqui).
-- ============================================================

CREATE OR REPLACE FUNCTION public.moderate_review(
  p_review_type TEXT,
  p_review_id UUID,
  p_action TEXT,
  p_actor_user_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_new_status TEXT;
  v_reason TEXT;
  v_before JSONB;
  v_reservation_id UUID;
  v_agency_id UUID;
  v_moderation_status TEXT;
  v_found BOOLEAN;
BEGIN
  -- 1) Tipo de resena valido.
  IF p_review_type NOT IN ('trip_review', 'agency_review') THEN
    RAISE EXCEPTION 'ERR_REVIEW_TYPE: p_review_type must be trip_review or agency_review';
  END IF;

  IF p_action NOT IN ('hide', 'reject', 'restore') THEN
    RAISE EXCEPTION 'ERR_REVIEW_ACTION: p_action must be hide, reject or restore';
  END IF;

  -- 2) Actor: SIEMPRE superadmin, validado contra public.users.
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_REVIEW_ADMIN_NOT_FOUND: Actor not found';
  END IF;

  SELECT u.* INTO v_actor
  FROM public.users u
  WHERE u.id = p_actor_user_id;

  IF NOT FOUND OR v_actor.role IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'ERR_REVIEW_ADMIN_ROLE: Only superadmins can moderate reviews';
  END IF;

  v_new_status := CASE p_action
    WHEN 'hide' THEN 'hidden'
    WHEN 'reject' THEN 'rejected'
    WHEN 'restore' THEN 'visible'
  END;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');

  -- 3) Fila con FOR UPDATE. Los nombres de tabla son FIJOS (no
  --    dinamicos); se separan las dos ramas para no referenciar
  --    columnas inexistentes (trip_reviews no tiene agency_id).
  IF p_review_type = 'trip_review' THEN
    SELECT tr.reservation_id, tr.moderation_status
      INTO v_reservation_id, v_moderation_status
    FROM public.trip_reviews tr
    WHERE tr.id = p_review_id
    FOR UPDATE;

    v_found := FOUND;

    IF NOT v_found THEN
      RAISE EXCEPTION 'ERR_REVIEW_NOT_FOUND: Review not found';
    END IF;

    v_before := jsonb_build_object('moderation_status', v_moderation_status);

    UPDATE public.trip_reviews
       SET moderation_status = v_new_status,
           moderated_by = p_actor_user_id,
           moderated_at = NOW(),
           moderation_reason = v_reason,
           updated_at = NOW()
     WHERE id = p_review_id;
  ELSE
    SELECT ar.reservation_id, ar.agency_id, ar.moderation_status
      INTO v_reservation_id, v_agency_id, v_moderation_status
    FROM public.agency_reviews ar
    WHERE ar.id = p_review_id
    FOR UPDATE;

    v_found := FOUND;

    IF NOT v_found THEN
      RAISE EXCEPTION 'ERR_REVIEW_NOT_FOUND: Review not found';
    END IF;

    v_before := jsonb_build_object('moderation_status', v_moderation_status);

    UPDATE public.agency_reviews
       SET moderation_status = v_new_status,
           moderated_by = p_actor_user_id,
           moderated_at = NOW(),
           moderation_reason = v_reason,
           updated_at = NOW()
     WHERE id = p_review_id;
  END IF;

  -- Agencia atribuible para la auditoria: la de la RESERVA (la de la
  -- agency_review ya se resolvio arriba; para trip_reviews se busca).
  IF v_agency_id IS NULL THEN
    SELECT r.agency_id INTO v_agency_id
    FROM public.reservations r
    WHERE r.id = v_reservation_id;
  END IF;

  -- 4) Auditoria ATOMICA (actor 'superadmin', INSERT directo identico
  --    a las ramas de creacion).
  INSERT INTO public.audit_log (
    actor_user_id, actor_role, agency_id,
    action, entity_type, entity_id, before, after, metadata
  ) VALUES (
    p_actor_user_id, 'superadmin', v_agency_id,
    'review.moderated', p_review_type, p_review_id,
    v_before,
    jsonb_build_object('moderation_status', v_new_status),
    jsonb_build_object(
      'action', p_action,
      'reason', v_reason,
      'reservation_id', v_reservation_id,
      'trigger', 'moderate_review'
    )
  );

  RETURN jsonb_build_object(
    'review_id', p_review_id,
    'review_type', p_review_type,
    'moderation_status', v_new_status,
    'moderated_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.moderate_review(TEXT, UUID, TEXT, UUID, TEXT) IS
  'REV-001: moderacion ATOMICA + auditada de una reseña por superadmin. hide/reject/restore sobre trip_reviews o agency_reviews. Valida el actor contra public.users (superadmin). Escribe review.moderated en audit_log en la MISMA transaccion. Preserva el contenido original. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.moderate_review(TEXT, UUID, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.moderate_review(TEXT, UUID, TEXT, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.moderate_review(TEXT, UUID, TEXT, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_review(TEXT, UUID, TEXT, UUID, TEXT) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.moderate_review(TEXT, UUID, TEXT, UUID, TEXT) OWNER TO postgres;
  END IF;
END $$;
