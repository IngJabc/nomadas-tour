-- ============================================================
-- 098_review_invitations.sql
-- REV-001 — Invitaciones de reseña + notificaciones internas de cliente.
--
-- Contexto:
--   REV-001 abre una ventana de 48 h desde la finalizacion de un
--   viaje para que el cliente evalúe el viaje y la agencia. El
--   Marketplace no tenia infraestructura de notificaciones de
--   cliente (la tabla notifications de Tour solo admite roles
--   'agency' y 'superadmin' — CHECK de 029/039). Este entrego crea
--   el mecanismo propio del Marketplace.
--
-- Decisiones de diseño (REV-001):
--   * UNA sola invitation por reserva (no dos): review_requests es
--     UNIQUE sobre reservation_id. La reseña de viaje y la de agencia
--     se registran en 099; aqui solo se gestiona la invitacion.
--   * expiracion = trips.completed_at + 48 h (NUNCA invited_at + 48 h).
--     Si la generacion se retrasa, la ventana NO se extiende: el
--     limite lo fija el completion del viaje.
--   * Generacion idempotente y recuperable via reconciliation
--     periodica (RPC generate_review_requests). No depende de un
--     evento unico: cubre ambos paths de completion (RPC y UPDATE
--     directo), eventos perdidos, caida del Marketplace y reintentos.
--   * La invitacion y la notificacion son entidades distintas: la
--     notificacion (customer_notifications) es solo el aviso interno;
--     la autoridad del estado es review_requests.
--
-- Integridad referencial:
--   Se agregan UNIQUE (id, trip_id/id, customer_id/id, agency_id/id)
--   sobre reservations para habilitar FOREIGN KEYS COMPUESTAS. Estas
--   garantizan a nivel de esquema que la reserva, el viaje, el cliente
--   y la agencia de una fila de review_requests pertenezcan todos a la
--   MISMA reserva (no basta con FK independientes, que permitirian
--   combinaciones cruzadas). Son constraints aditivos: id ya es la PK,
--   por lo que (id, x) siempre es unico y la adicion no cambia filas.
--
-- Prohibido en esta migracion:
--   Editar migraciones historicas; tocar RPCs de tour; tocar los CHECK
--   de audit_log (los amplia 099); BEGIN/COMMIT; SQL de rollback.
--
-- Dry-run:   BEGIN;  \i 098_review_invitations.sql   ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) reservations: UNIQUE habilitadores de FK compuesta.
--    Aditivos (id es la PK, por lo que la unicidad ya se cumple);
--    solo habilitan que review_requests/reviews referencien el par
--    (id, x) y asi amarren reservation+trip+customer+agency en una
--    unica fila coherente.
-- ============================================================

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_id_trip_id_unique UNIQUE (id, trip_id);

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_id_customer_id_unique UNIQUE (id, customer_id);

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_id_agency_id_unique UNIQUE (id, agency_id);

-- ============================================================
-- 2) review_requests — invitation por reserva (UNIQUE).
-- ============================================================

CREATE TABLE public.review_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- UNA invitacion por reserva. ON DELETE CASCADE: si la reserva
  -- desaparece, su invitation no tiene sentido.
  reservation_id UUID NOT NULL
    UNIQUE
    REFERENCES public.reservations(id) ON DELETE CASCADE,

  -- Atribucion congelada al momento de invitar, amarrada por FK
  -- compuesta a la MISMA reserva (coherencia reservation+trip+
  -- customer+agency garantizada por esquema, no solo por backend).
  trip_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  agency_id UUID NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'expired')),

  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ventana = trips.completed_at + 48 h. Solo el servidor la calcula
  -- (generate_review_requests); nunca llega del cliente.
  expires_at TIMESTAMPTZ NOT NULL,

  completed_at TIMESTAMPTZ NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- completed exige su marca temporal.
  CONSTRAINT review_requests_completed_fields_check CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR status <> 'completed'
  ),

  -- Coherencia reservation+trip.
  FOREIGN KEY (reservation_id, trip_id)
    REFERENCES public.reservations(id, trip_id),
  -- Coherencia reservation+customer.
  FOREIGN KEY (reservation_id, customer_id)
    REFERENCES public.reservations(id, customer_id),
  -- Coherencia reservation+agency.
  FOREIGN KEY (reservation_id, agency_id)
    REFERENCES public.reservations(id, agency_id)
);

COMMENT ON TABLE public.review_requests IS
  'REV-001: invitacion de reseña por reserva marketplace (UNIQUE sobre reservation_id). Autoridad del estado de la invitacion (pending/completed/expired). expiracion = trips.completed_at + 48 h, calculada por el servidor. Generada por la reconciliation idempotente generate_review_requests, no por un evento unico.';
COMMENT ON COLUMN public.review_requests.expires_at IS
  'REV-001: trips.completed_at + 48 h. NUNCA invited_at + 48 h: si la generacion se retrasa, la ventana NO se extiende.';
COMMENT ON COLUMN public.review_requests.customer_id IS
  'REV-001: cliente dueño de la reserva (dueno comercial marketplace). Amarrado por FK compuesta a la MISMA reserva.';

CREATE INDEX IF NOT EXISTS idx_review_requests_customer_status
  ON public.review_requests (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_review_requests_status_expires
  ON public.review_requests (status, expires_at);

CREATE TRIGGER review_requests_updated_t
  BEFORE UPDATE ON public.review_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 3) customer_notifications — notificacion interna de cliente.
--    Nueva (Marketplace no tenia ninguna; notifications de Tour es
--    solo agency/superadmin). Entidad DISTINTA de la invitacion: el
--    aviso no autoriza nada; la autoridad del estado es review_requests.
-- ============================================================

CREATE TABLE public.customer_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  customer_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,

  type TEXT NOT NULL
    CHECK (type IN ('review_pending')),

  title TEXT NOT NULL,
  body TEXT NOT NULL,

  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('reservation', 'review_request')),
  entity_id UUID NOT NULL,

  -- URL de accion interna del Marketplace (nunca un token).
  action_url TEXT,

  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.customer_notifications IS
  'REV-001: notificaciones internas del Marketplace para clientes. Nueva porque notifications (029) solo admite roles agency/superadmin. Entidad separada de review_requests: el aviso no autoriza nada.';

CREATE INDEX IF NOT EXISTS idx_customer_notifications_customer
  ON public.customer_notifications (customer_id, created_at DESC);

-- ============================================================
-- 4) RLS
--    review_requests: el cliente solo LEE la suya; la escribe el
--    backend (service_role) via RPC. customer_notifications: el
--    cliente lee las suyas y puede marcarlas leidas; service_role
--    las crea. anon queda fuera (deny-by-default con RLS habilitada
--    y sin policy para anon).
-- ============================================================

ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;

-- review_requests: lectura propia del cliente (nunca de otros).
DROP POLICY IF EXISTS "review_requests_customer_read" ON public.review_requests;
CREATE POLICY "review_requests_customer_read" ON public.review_requests
  FOR SELECT
  USING (customer_id = auth.uid());

-- superadmin puede inspeccionar todas (panel de moderacion).
DROP POLICY IF EXISTS "review_requests_superadmin_read" ON public.review_requests;
CREATE POLICY "review_requests_superadmin_read" ON public.review_requests
  FOR SELECT
  USING ((SELECT private.auth_app_role()) = 'superadmin');

-- customer_notifications: lectura propia.
DROP POLICY IF EXISTS "customer_notifications_customer_read" ON public.customer_notifications;
CREATE POLICY "customer_notifications_customer_read" ON public.customer_notifications
  FOR SELECT
  USING (customer_id = auth.uid());

-- customer_notifications: el cliente solo marca read_at (no cambia
-- contenido ni dueno). NOTA: RLS restringe FILAS, no columnas; el
-- alcance exacto a read_at lo garantiza el GRANT UPDATE (read_at) de
-- la seccion de permisos mas abajo.
DROP POLICY IF EXISTS "customer_notifications_customer_update" ON public.customer_notifications;
CREATE POLICY "customer_notifications_customer_update" ON public.customer_notifications
  FOR UPDATE
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

-- superadmin puede inspeccionar todas.
DROP POLICY IF EXISTS "customer_notifications_superadmin_read" ON public.customer_notifications;
CREATE POLICY "customer_notifications_superadmin_read" ON public.customer_notifications
  FOR SELECT
  USING ((SELECT private.auth_app_role()) = 'superadmin');

-- Escritura de ambas tablas: solo service_role (RLS activa sin policy
-- de INSERT para authenticated/anon => deny-by-default). service_role
-- BYPASSRLS en Supabase, asi que no necesita policy propia.
-- Excepcion DELIMITADA: customer_notifications permite al cliente
-- marcar leida su propia fila, pero SOLO la columna read_at (grant a
-- nivel de columna). Sin el REVOKE de UPDATE, cualquier cliente
-- autenticado podria reescribir type/title/body/entity_id/action_url
-- de sus propias notificaciones (la policy solo filtra filas).
REVOKE ALL ON TABLE public.review_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.review_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.review_requests FROM authenticated;

REVOKE ALL ON TABLE public.customer_notifications FROM PUBLIC;
REVOKE ALL ON TABLE public.customer_notifications FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.customer_notifications FROM authenticated;
GRANT UPDATE (read_at) ON TABLE public.customer_notifications TO authenticated;

-- ============================================================
-- 5) generate_review_requests — reconciliation idempotente.
--    Encuentra reservas marketplace confirmadas cuyo viaje esta
--    completado DENTRO de la ventana y sin invitation; crea la
--    invitation (ON CONFLICT DO NOTHING) + la notificacion interna en
--    la MISMA transaccion por reserva. Ademas expira las pendientes
--    vencidas. Segura ante ejecuciones multiples/concurrentes: la
--    restriccion UNIQUE sobre reservation_id evita duplicados y el
--    ON CONFLICT absorbe la carrera.
-- ============================================================

CREATE OR REPLACE FUNCTION public.generate_review_requests()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window CONSTANT INTERVAL := interval '48 hours';
  v_created INTEGER := 0;
  v_expired INTEGER := 0;
  v_failed INTEGER := 0;
  v_res RECORD;
  v_inserted BOOLEAN;
  v_already_reviewed BOOLEAN := FALSE;
BEGIN
  -- 1) Invitaciones nuevas. La ventana se mide contra
  --    trips.completed_at (NO invited_at): un retraso en la
  --    generacion NUNCA extiende el plazo del cliente. Lista inclusiva
  --    de estados confirmados (incluye 'partial', estado de boarding
  --    compartido con Tour); excluye locked y cancelled.
  FOR v_res IN
    SELECT r.id AS reservation_id,
           r.trip_id,
           r.customer_id,
           r.agency_id,
           t.completed_at
      FROM public.reservations r
      JOIN public.trips t ON t.id = r.trip_id
     WHERE r.source = 'marketplace'
       AND r.customer_id IS NOT NULL
       AND r.agency_id IS NOT NULL
       AND r.status IN ('reserved', 'confirmed', 'completed', 'boarded', 'partial')
       AND t.status = 'completed'
       AND t.completed_at IS NOT NULL
       AND t.completed_at + v_window > NOW()
       AND NOT EXISTS (
         SELECT 1 FROM public.review_requests rr
          WHERE rr.reservation_id = r.id
       )
     ORDER BY t.completed_at
     LIMIT 500
  LOOP
    -- No invitar a algo ya reseñado (099 crea las DOS reseñas juntas;
    -- trip_reviews basta por atomicidad). El filtro vive en una
    -- sentencia SEPARADA bajo IF to_regclass, no como sublink del
    -- SELECT: plpgsql solo prepara la rama que ejecuta (lazy), mientras
    -- que un sublink inline se analiza SIEMPRE aunque su rama del OR
    -- nunca corra y abortaria el lote con "relation trip_reviews does
    -- not exist" cuando 099 aun no este aplicada (despliegue
    -- escalonado o tras rollback de 099). Sin 099 nadie pudo reseñar,
    -- asi que omitir el filtro es correcto.
    IF to_regclass('public.trip_reviews') IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.trip_reviews tr
         WHERE tr.reservation_id = v_res.reservation_id
      ) INTO v_already_reviewed;

      IF v_already_reviewed THEN
        CONTINUE;
      END IF;
    END IF;

    BEGIN
      -- Invitation + notificacion atomica por reserva. La expiracion
      -- se deriva del completion del viaje, jamas de invited_at.
      INSERT INTO public.review_requests (
        reservation_id, trip_id, customer_id, agency_id,
        status, invited_at, expires_at
      ) VALUES (
        v_res.reservation_id, v_res.trip_id, v_res.customer_id, v_res.agency_id,
        'pending', NOW(), v_res.completed_at + v_window
      )
      ON CONFLICT (reservation_id) DO NOTHING;

      v_inserted := FOUND;

      IF v_inserted THEN
        v_created := v_created + 1;

        -- Notificacion interna (no es un token; la URL no autoriza).
        INSERT INTO public.customer_notifications (
          customer_id, type, title, body,
          entity_type, entity_id, action_url
        ) VALUES (
          v_res.customer_id,
          'review_pending',
          'Califica tu viaje',
          'Tu viaje ya finalizó. Cuéntanos cómo te fue: tardas menos de 2 minutos.',
          'reservation',
          v_res.reservation_id,
          '/account/reviews/' || v_res.reservation_id::text
        );
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        -- Carrera entre instancias: otra ya creo la invitation.
        NULL;
      WHEN others THEN
        -- Una reservation problematica no aborta el lote: se omite,
        -- se LOGUEA (nunca en silencio) y la proxima reconciliation
        -- la reintenta. El contador v_failed sale en el JSONB para
        -- que el caller detecte fallos sistemicos.
        v_failed := v_failed + 1;
        RAISE LOG 'generate_review_requests: reservation % fallo: %',
          v_res.reservation_id, SQLERRM;
    END;
  END LOOP;

  -- 2) Expirar pendientes vencidas (la autoridad del tiempo es la BD).
  UPDATE public.review_requests
     SET status = 'expired', updated_at = NOW()
   WHERE status = 'pending'
     AND expires_at <= NOW();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object(
    'created', v_created,
    'expired', v_expired,
    'failed', v_failed
  );
END;
$$;

COMMENT ON FUNCTION public.generate_review_requests() IS
  'REV-001: reconciliacion idempotente de invitaciones de reseña. Crea review_requests (UNIQUE por reservation) + customer_notification para reservas marketplace confirmadas cuyo viaje esta completado dentro de la ventana (trips.completed_at + 48 h), y expira las pendientes vencidas. Segura ante ejecuciones multiples/concurrentes (ON CONFLICT DO NOTHING). SECURITY DEFINER; EXECUTE service_role only.';

REVOKE ALL ON FUNCTION public.generate_review_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_review_requests() FROM anon;
REVOKE ALL ON FUNCTION public.generate_review_requests() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.generate_review_requests() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.generate_review_requests() OWNER TO postgres;
  END IF;
END $$;
