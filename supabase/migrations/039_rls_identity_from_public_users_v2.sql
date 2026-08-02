-- ============================================================

-- 039_rls_identity_from_public_users_v2.sql

-- FASE 2 v2 — RLS desde public.users vía helpers private.* (SECURITY DEFINER)

--

-- RCA confirmado: 036 inline EXISTS(public.users) → SQLSTATE 42P17 → Realtime roto.

-- Rollback de emergencia (manual): supabase/rollbacks/039_rollback_restore_metadata_rls.sql

--

-- *** NO EJECUTAR TODO DE UNA VEZ — STAGING INCREMENTAL ***

--   1) PART 0 — exportar snapshot pg_policies (estado vivo)

--   2) PART 1 — helpers + validar helpers (sin 42P17)

--   3) PART 2 — STEP A Realtime + validar canales

--   4) PART 3 — STEP B admin + C4 seats + validación final

--

-- NO TOCA: publicaciones supabase_realtime, *_public_read, frontend, backend.

-- Objetivo: 0 policies de autorización con user_metadata o public.users inline.

-- ============================================================



-- ============================================================

-- PART 0 — EXPORTACIÓN REAL pg_policies (antes del primer DROP POLICY)

-- Ejecutar PART 0 + PART 1 juntos, o PART 0 primero si el schema private no existe.

-- ============================================================



CREATE SCHEMA IF NOT EXISTS private;



CREATE TABLE IF NOT EXISTS private.migration_039_policy_snapshot (

  id bigserial PRIMARY KEY,

  captured_at timestamptz NOT NULL DEFAULT now(),

  migration_part text NOT NULL,

  schemaname text NOT NULL,

  tablename text NOT NULL,

  policyname text NOT NULL,

  permissive text,

  cmd text,

  qual text,

  with_check text

);



CREATE INDEX IF NOT EXISTS idx_migration_039_snapshot_part

  ON private.migration_039_policy_snapshot (migration_part, tablename, policyname);



-- Idempotente: re-ejecutar PART 0 sobrescribe el snapshot pre-migración

DELETE FROM private.migration_039_policy_snapshot

WHERE migration_part = 'pre_039';



INSERT INTO private.migration_039_policy_snapshot (

  migration_part,

  schemaname,

  tablename,

  policyname,

  permissive,

  cmd,

  qual,

  with_check

)

SELECT

  'pre_039',

  schemaname,

  tablename,

  policyname,

  permissive,

  cmd,

  qual::text,

  COALESCE(with_check::text, '')

FROM pg_policies

WHERE schemaname = 'public';



-- Export legible para comparar con repo / prod (incl. agency_invitations.*)

SELECT

  tablename,

  policyname,

  cmd,

  qual,

  with_check

FROM private.migration_039_policy_snapshot

WHERE migration_part = 'pre_039'

ORDER BY tablename, policyname;



-- Conteo rápido (archivar junto al resultado anterior)

SELECT count(*) AS policy_count_pre_039

FROM private.migration_039_policy_snapshot

WHERE migration_part = 'pre_039';



-- ============================================================

-- PART 1 — HELPERS SECURITY DEFINER (sin tocar policies)

-- ============================================================



CREATE OR REPLACE FUNCTION private.auth_app_role()

RETURNS text

LANGUAGE plpgsql

STABLE

SECURITY DEFINER

SET search_path = ''

AS $$

BEGIN

  RETURN (

    SELECT u.role

    FROM public.users AS u

    WHERE u.id = (SELECT auth.uid())

    LIMIT 1

  );

END;

$$;



CREATE OR REPLACE FUNCTION private.auth_app_agency_id()

RETURNS uuid

LANGUAGE plpgsql

STABLE

SECURITY DEFINER

SET search_path = ''

AS $$

BEGIN

  RETURN (

    SELECT u.agency_id

    FROM public.users AS u

    WHERE u.id = (SELECT auth.uid())

    LIMIT 1

  );

END;

$$;



REVOKE ALL ON FUNCTION private.auth_app_role() FROM PUBLIC;

REVOKE ALL ON FUNCTION private.auth_app_agency_id() FROM PUBLIC;



GRANT EXECUTE ON FUNCTION private.auth_app_role() TO authenticated;

GRANT EXECUTE ON FUNCTION private.auth_app_agency_id() TO authenticated;



-- Required for authenticated RLS policies and Realtime to call private.* helpers

GRANT USAGE ON SCHEMA private TO authenticated;

GRANT USAGE ON SCHEMA private TO service_role;



-- ------------------------------------------------------------

-- PART 1 — Validación helpers (JWT simulado; no modifica datos)

-- Sustituir UUID por usuario agency real de public.users

-- ------------------------------------------------------------

--

-- BEGIN;

-- SET LOCAL role authenticated;

-- SET LOCAL request.jwt.claim.sub = '40b148eb-0d67-4af0-8332-72f58a397fc7';

--

-- SELECT private.auth_app_role() AS role;

-- SELECT private.auth_app_agency_id() AS agency_id;

--

-- Esperado: role = 'agency', agency_id NOT NULL, sin SQLSTATE 42P17

--

-- ROLLBACK;



-- ================================================================

-- ⏸ PAUSA — Validar PART 1 antes de PART 2 (STEP A)

-- ================================================================



-- ============================================================

-- PART 2 — STEP A: Realtime + INSERT policies migradas

--

-- DROP → CREATE (16 policies):

--   agencies_own_read, agencies_superadmin_all

--   notifications_agency_select, notifications_agency_update

--   notifications_superadmin_select, notifications_superadmin_update

--   reservations_agency_read, reservations_agency_insert, reservations_superadmin_all

--   rp_agency_read, rp_superadmin_all

--   bl_agency_read, bl_agency_insert, bl_superadmin_all

--

-- NO TOCA: *_public_read

-- ============================================================



-- ----- 2.1 AGENCIES -----



DROP POLICY IF EXISTS "agencies_superadmin_all" ON public.agencies;

CREATE POLICY "agencies_superadmin_all" ON public.agencies

  FOR ALL USING (

    (SELECT private.auth_app_role()) = 'superadmin'

  );



DROP POLICY IF EXISTS "agencies_own_read" ON public.agencies;

CREATE POLICY "agencies_own_read" ON public.agencies

  FOR SELECT USING (

    (SELECT private.auth_app_role()) = 'agency'

    AND id = (SELECT private.auth_app_agency_id())

  );



-- agencies_public_read — SIN CAMBIOS



-- ----- 2.2 NOTIFICATIONS -----



DROP POLICY IF EXISTS "notifications_agency_select" ON public.notifications;

CREATE POLICY "notifications_agency_select" ON public.notifications

  FOR SELECT USING (

    (SELECT private.auth_app_role()) = 'agency'

    AND agency_id = (SELECT private.auth_app_agency_id())

  );



DROP POLICY IF EXISTS "notifications_agency_update" ON public.notifications;

CREATE POLICY "notifications_agency_update" ON public.notifications

  FOR UPDATE USING (

    (SELECT private.auth_app_role()) = 'agency'

    AND agency_id = (SELECT private.auth_app_agency_id())

  );



DROP POLICY IF EXISTS "notifications_superadmin_select" ON public.notifications;

CREATE POLICY "notifications_superadmin_select" ON public.notifications

  FOR SELECT USING (

    (SELECT private.auth_app_role()) = 'superadmin'

  );



DROP POLICY IF EXISTS "notifications_superadmin_update" ON public.notifications;

CREATE POLICY "notifications_superadmin_update" ON public.notifications

  FOR UPDATE USING (

    (SELECT private.auth_app_role()) = 'superadmin'

  );



-- ----- 2.3 RESERVATIONS -----



DROP POLICY IF EXISTS "reservations_agency_read" ON public.reservations;

CREATE POLICY "reservations_agency_read" ON public.reservations

  FOR SELECT USING (

    (SELECT private.auth_app_role()) = 'agency'

    AND agency_id = (SELECT private.auth_app_agency_id())

  );



DROP POLICY IF EXISTS "reservations_agency_insert" ON public.reservations;

CREATE POLICY "reservations_agency_insert" ON public.reservations

  FOR INSERT WITH CHECK (

    (SELECT private.auth_app_role()) = 'agency'

    AND agency_id = (SELECT private.auth_app_agency_id())

  );



DROP POLICY IF EXISTS "reservations_superadmin_all" ON public.reservations;

CREATE POLICY "reservations_superadmin_all" ON public.reservations

  FOR ALL USING (

    (SELECT private.auth_app_role()) = 'superadmin'

  );



-- ----- 2.4 RESERVATION_PASSENGERS -----



DROP POLICY IF EXISTS "rp_agency_read" ON public.reservation_passengers;

CREATE POLICY "rp_agency_read" ON public.reservation_passengers

  FOR SELECT USING (

    (SELECT private.auth_app_role()) = 'agency'

    AND reservation_id IN (

      SELECT r.id

      FROM public.reservations AS r

      WHERE r.agency_id = (SELECT private.auth_app_agency_id())

    )

  );



DROP POLICY IF EXISTS "rp_superadmin_all" ON public.reservation_passengers;

CREATE POLICY "rp_superadmin_all" ON public.reservation_passengers

  FOR ALL USING (

    (SELECT private.auth_app_role()) = 'superadmin'

  );



-- ----- 2.5 BOARDING_LOGS -----



DROP POLICY IF EXISTS "bl_agency_read" ON public.boarding_logs;

CREATE POLICY "bl_agency_read" ON public.boarding_logs

  FOR SELECT USING (

    (SELECT private.auth_app_role()) = 'agency'

    AND reservation_id IN (

      SELECT r.id

      FROM public.reservations AS r

      WHERE r.agency_id = (SELECT private.auth_app_agency_id())

    )

  );



DROP POLICY IF EXISTS "bl_agency_insert" ON public.boarding_logs;

CREATE POLICY "bl_agency_insert" ON public.boarding_logs

  FOR INSERT WITH CHECK (

    (SELECT private.auth_app_role()) = 'agency'

    AND reservation_id IN (

      SELECT r.id

      FROM public.reservations AS r

      WHERE r.agency_id = (SELECT private.auth_app_agency_id())

    )

  );



DROP POLICY IF EXISTS "bl_superadmin_all" ON public.boarding_logs;

CREATE POLICY "bl_superadmin_all" ON public.boarding_logs

  FOR ALL USING (

    (SELECT private.auth_app_role()) = 'superadmin'

  );



-- Snapshot post STEP A (comparación incremental)

DELETE FROM private.migration_039_policy_snapshot

WHERE migration_part = 'post_step_a';



INSERT INTO private.migration_039_policy_snapshot (

  migration_part, schemaname, tablename, policyname, permissive, cmd, qual, with_check

)

SELECT

  'post_step_a', schemaname, tablename, policyname, permissive, cmd,

  qual::text, COALESCE(with_check::text, '')

FROM pg_policies

WHERE schemaname = 'public';



-- ============================================================

-- PART 2 — Validación STEP A

-- ============================================================

--

-- Anti-recursión (agency UUID real):

-- BEGIN;

-- SET LOCAL role authenticated;

-- SET LOCAL request.jwt.claim.sub = '40b148eb-0d67-4af0-8332-72f58a397fc7';

-- SELECT count(*) FROM public.users;

-- SELECT count(*) FROM public.notifications;

-- SELECT count(*) FROM public.reservations;

-- SELECT count(*) FROM public.reservation_passengers;

-- SELECT count(*) FROM public.boarding_logs;

-- SELECT count(*) FROM public.agencies;

-- ROLLBACK;

--

-- STEP A: 0 user_metadata / 0 public.users en tablas migradas:

-- SELECT tablename, policyname

-- FROM pg_policies

-- WHERE schemaname = 'public'

--   AND tablename IN (

--     'agencies','notifications','reservations',

--     'reservation_passengers','boarding_logs'

--   )

--   AND policyname NOT IN ('agencies_public_read')

--   AND (

--     qual::text ILIKE '%user_metadata%'

--     OR qual::text ILIKE '%public.users%'

--     OR coalesce(with_check::text,'') ILIKE '%user_metadata%'

--     OR coalesce(with_check::text,'') ILIKE '%public.users%'

--   );

-- Esperado: 0 filas

--

-- Realtime manual: notifications, reservations, passengers, boarding_logs, agencies

-- Esperado: sin CHANNEL_ERROR



-- ================================================================

-- ⏸ PAUSA — Validar STEP A + Realtime antes de PART 3 (STEP B)

-- ================================================================



-- ============================================================

-- PART 3 — STEP B: admin + C4 seats

--

-- DROP → CREATE:

--   routes_superadmin_all, trips_superadmin_all, seats_superadmin_all

--   ta_superadmin_all, users_agency_read, users_superadmin_all

--   agency_notif_prefs_select, superadmin_notif_prefs_select

--   invitations_superadmin_all, ai_superadmin_all (condicional)

--

-- DROP sin recrear (C4):

--   seats_auth_update

--

-- REVOKE (C4):

--   UPDATE ON public.seats FROM anon, authenticated

--

-- NO TOCA:

--   seats_public_read, trips_public_read, routes_public_read,

--   ta_public_read, agencies_public_read, ai_public_read

-- ============================================================



-- ----- 3.1 ROUTES -----



DROP POLICY IF EXISTS "routes_superadmin_all" ON public.routes;

CREATE POLICY "routes_superadmin_all" ON public.routes

  FOR ALL USING (

    (SELECT private.auth_app_role()) = 'superadmin'

  );



-- routes_public_read — SIN CAMBIOS



-- ----- 3.2 TRIPS -----



DROP POLICY IF EXISTS "trips_superadmin_all" ON public.trips;

CREATE POLICY "trips_superadmin_all" ON public.trips

  FOR ALL USING (

    (SELECT private.auth_app_role()) = 'superadmin'

  );



-- trips_public_read — SIN CAMBIOS



-- ----- 3.3 SEATS (C4 — eliminar escritura cliente) -----



DROP POLICY IF EXISTS "seats_auth_update" ON public.seats;



DROP POLICY IF EXISTS "seats_superadmin_all" ON public.seats;

CREATE POLICY "seats_superadmin_all" ON public.seats

  FOR ALL USING (

    (SELECT private.auth_app_role()) = 'superadmin'

  );



REVOKE UPDATE ON public.seats FROM anon;

REVOKE UPDATE ON public.seats FROM authenticated;



-- seats_public_read — SIN CAMBIOS



-- ----- 3.4 TRIP_AGENCIES -----



DROP POLICY IF EXISTS "ta_superadmin_all" ON public.trip_agencies;

CREATE POLICY "ta_superadmin_all" ON public.trip_agencies

  FOR ALL USING (

    (SELECT private.auth_app_role()) = 'superadmin'

  );



-- ta_public_read — SIN CAMBIOS



-- ----- 3.5 USERS -----



DROP POLICY IF EXISTS "users_agency_read" ON public.users;

CREATE POLICY "users_agency_read" ON public.users

  FOR SELECT USING (

    (SELECT private.auth_app_role()) = 'agency'

    AND agency_id = (SELECT private.auth_app_agency_id())

  );



DROP POLICY IF EXISTS "users_superadmin_all" ON public.users;

CREATE POLICY "users_superadmin_all" ON public.users

  FOR ALL USING (

    (SELECT private.auth_app_role()) = 'superadmin'

  );



-- ----- 3.6 AGENCY NOTIFICATION PREFERENCES -----



DROP POLICY IF EXISTS "agency_notif_prefs_select" ON public.agency_notification_preferences;

CREATE POLICY "agency_notif_prefs_select" ON public.agency_notification_preferences

  FOR SELECT USING (

    (SELECT private.auth_app_role()) = 'agency'

    AND agency_id = (SELECT private.auth_app_agency_id())

  );



DROP POLICY IF EXISTS "superadmin_notif_prefs_select" ON public.agency_notification_preferences;

CREATE POLICY "superadmin_notif_prefs_select" ON public.agency_notification_preferences

  FOR SELECT USING (

    (SELECT private.auth_app_role()) = 'superadmin'

  );



-- ----- 3.7 AGENCY_INVITATIONS (condicional) -----



DO $$

BEGIN

  IF to_regclass('public.agency_invitations') IS NOT NULL THEN

    EXECUTE 'DROP POLICY IF EXISTS "invitations_superadmin_all" ON public.agency_invitations';

    EXECUTE $policy$

      CREATE POLICY "invitations_superadmin_all" ON public.agency_invitations

        FOR ALL USING (

          (SELECT private.auth_app_role()) = 'superadmin'

        )

    $policy$;



    IF EXISTS (

      SELECT 1 FROM pg_policies

      WHERE schemaname = 'public'

        AND tablename = 'agency_invitations'

        AND policyname = 'ai_superadmin_all'

    ) THEN

      EXECUTE 'DROP POLICY IF EXISTS "ai_superadmin_all" ON public.agency_invitations';

      EXECUTE $policy$

        CREATE POLICY "ai_superadmin_all" ON public.agency_invitations

          FOR ALL USING (

            (SELECT private.auth_app_role()) = 'superadmin'

          )

      $policy$;

    END IF;

  END IF;

END $$;



-- ai_public_read — SIN CAMBIOS



-- Snapshot post STEP B (estado final 039)

DELETE FROM private.migration_039_policy_snapshot

WHERE migration_part = 'post_step_b';



INSERT INTO private.migration_039_policy_snapshot (

  migration_part, schemaname, tablename, policyname, permissive, cmd, qual, with_check

)

SELECT

  'post_step_b', schemaname, tablename, policyname, permissive, cmd,

  qual::text, COALESCE(with_check::text, '')

FROM pg_policies

WHERE schemaname = 'public';



-- Comparar pre vs post (policies que cambiaron de qual)

-- SELECT pre.tablename, pre.policyname,

--        pre.qual AS qual_before, post.qual AS qual_after

-- FROM private.migration_039_policy_snapshot pre

-- JOIN private.migration_039_policy_snapshot post

--   ON pre.tablename = post.tablename AND pre.policyname = post.policyname

-- WHERE pre.migration_part = 'pre_039' AND post.migration_part = 'post_step_b'

--   AND (pre.qual IS DISTINCT FROM post.qual OR pre.with_check IS DISTINCT FROM post.with_check)

-- ORDER BY pre.tablename, pre.policyname;



-- ============================================================

-- PART 4 — Validación final post STEP B

-- ============================================================

--

-- 4.1 Anti-recursión:

-- BEGIN;

-- SET LOCAL role authenticated;

-- SET LOCAL request.jwt.claim.sub = '40b148eb-0d67-4af0-8332-72f58a397fc7';

-- SELECT count(*) FROM public.users;

-- SELECT count(*) FROM public.notifications;

-- SELECT count(*) FROM public.reservations;

-- SELECT count(*) FROM public.reservation_passengers;

-- SELECT count(*) FROM public.boarding_logs;

-- ROLLBACK;

--

-- 4.2 Cero public.users inline (policies de autorización):

-- SELECT tablename, policyname, qual, with_check

-- FROM pg_policies

-- WHERE schemaname = 'public'

--   AND policyname NOT IN ('agencies_public_read','routes_public_read','trips_public_read',

--                          'seats_public_read','ta_public_read','ai_public_read')

--   AND (

--     qual::text ILIKE '%public.users%'

--     OR coalesce(with_check::text,'') ILIKE '%public.users%'

--   );

-- Esperado: 0 filas

--

-- 4.3 Cero user_metadata en policies de autorización:

-- SELECT tablename, policyname

-- FROM pg_policies

-- WHERE schemaname = 'public'

--   AND policyname NOT IN (

--     'agencies_public_read','routes_public_read','trips_public_read',

--     'seats_public_read','ta_public_read','ai_public_read'

--   )

--   AND (

--     qual::text ILIKE '%user_metadata%'

--     OR coalesce(with_check::text,'') ILIKE '%user_metadata%'

--   );

-- Esperado: 0 filas

--

-- 4.4 seats_auth_update eliminada:

-- SELECT policyname FROM pg_policies

-- WHERE tablename = 'seats' AND policyname = 'seats_auth_update';

-- Esperado: 0 filas

--

-- 4.5 Lecturas públicas intactas (5 filas):

-- SELECT policyname FROM pg_policies

-- WHERE policyname IN (

--   'seats_public_read','trips_public_read','routes_public_read',

--   'ta_public_read','agencies_public_read'

-- );

--

-- 4.6 Helpers presentes (2 filas):

-- SELECT n.nspname, p.proname FROM pg_proc p

-- JOIN pg_namespace n ON n.oid = p.pronamespace

-- WHERE n.nspname = 'private' AND p.proname IN ('auth_app_role','auth_app_agency_id');

--

-- 4.7 Realtime manual: seats, reservations, notifications, boarding_logs,

--     reservation_passengers, agencies — sin CHANNEL_ERROR

--

-- 4.8 C4 — UPDATE cliente bloqueado en seats:

-- (desde consola browser autenticado)

-- await supabase.from('seats').update({ status: 'locked' }).eq('seat_code','A1');

-- Esperado: error permisos, data null


