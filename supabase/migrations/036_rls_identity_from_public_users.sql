-- ============================================================
-- 036_rls_identity_from_public_users.sql
-- *** NO APLICAR — superseded by 039_rls_identity_from_public_users_v2.sql ***
-- Causa confirmada en instancia: recursión RLS 42P17 en public.users.
-- Rollback aplicado: 038_revert_036_rls.sql
-- ============================================================
-- FASE 2 — Security Hardening Sprint (SEC-001 RLS)
--
-- Reemplaza auth.jwt()->user_metadata por public.users + auth.uid()
-- como fuente de verdad de rol/agencia en políticas de autorización.
--
-- NO TOCA (Realtime / lectura pública):
--   agencies_public_read, routes_public_read, trips_public_read,
--   seats_public_read, ta_public_read
--
-- ELIMINA (escritura cliente innecesaria; Express/service_role escribe):
--   seats_auth_update, reservations_agency_insert, bl_agency_insert
--
-- Inventario DROP → CREATE (reescritura):
--   agencies_superadmin_all, agencies_own_read
--   routes_superadmin_all
--   users_own_read (nueva — evita recursión RLS en subconsultas)
--   users_agency_read, users_superadmin_all
--   trips_superadmin_all
--   seats_superadmin_all
--   ta_superadmin_all
--   reservations_agency_read, reservations_superadmin_all
--   rp_agency_read, rp_superadmin_all
--   bl_agency_read, bl_superadmin_all
--   notifications_agency_select, notifications_agency_update
--   notifications_superadmin_select, notifications_superadmin_update
--   agency_notif_prefs_select, superadmin_notif_prefs_select
--
-- Condicional (solo si existe la tabla):
--   invitations_superadmin_all ON agency_invitations
-- ============================================================

-- ----------------------------------------------------------------
-- Helper expressions (inline, sin funciones SECURITY DEFINER)
--   is_superadmin: EXISTS public.users WHERE id = auth.uid() AND role = 'superadmin'
--   is_agency(agency_id): EXISTS ... role = 'agency' AND u.agency_id = agency_id
-- ----------------------------------------------------------------

-- ============================================================
-- 1. AGENCIES
-- ============================================================

DROP POLICY IF EXISTS "agencies_superadmin_all" ON agencies;
CREATE POLICY "agencies_superadmin_all" ON agencies
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

DROP POLICY IF EXISTS "agencies_own_read" ON agencies;
CREATE POLICY "agencies_own_read" ON agencies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = 'agency'
        AND u.agency_id = agencies.id
    )
  );

-- agencies_public_read — SIN CAMBIOS

-- ============================================================
-- 2. ROUTES
-- ============================================================

DROP POLICY IF EXISTS "routes_superadmin_all" ON routes;
CREATE POLICY "routes_superadmin_all" ON routes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

-- routes_public_read — SIN CAMBIOS

-- ============================================================
-- 3. USERS
-- ============================================================

DROP POLICY IF EXISTS "users_own_read" ON users;
CREATE POLICY "users_own_read" ON users
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "users_agency_read" ON users;
CREATE POLICY "users_agency_read" ON users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = 'agency'
        AND u.agency_id = users.agency_id
    )
  );

DROP POLICY IF EXISTS "users_superadmin_all" ON users;
CREATE POLICY "users_superadmin_all" ON users
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

-- ============================================================
-- 4. TRIPS
-- ============================================================

DROP POLICY IF EXISTS "trips_superadmin_all" ON trips;
CREATE POLICY "trips_superadmin_all" ON trips
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

-- trips_public_read — SIN CAMBIOS

-- ============================================================
-- 5. SEATS — eliminar escritura cliente
-- ============================================================

DROP POLICY IF EXISTS "seats_auth_update" ON seats;

DROP POLICY IF EXISTS "seats_superadmin_all" ON seats;
CREATE POLICY "seats_superadmin_all" ON seats
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

-- seats_public_read — SIN CAMBIOS

REVOKE UPDATE ON public.seats FROM anon;
REVOKE UPDATE ON public.seats FROM authenticated;

-- ============================================================
-- 6. TRIP_AGENCIES
-- ============================================================

DROP POLICY IF EXISTS "ta_superadmin_all" ON trip_agencies;
CREATE POLICY "ta_superadmin_all" ON trip_agencies
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

-- ta_public_read — SIN CAMBIOS

-- ============================================================
-- 7. RESERVATIONS — eliminar INSERT cliente
-- ============================================================

DROP POLICY IF EXISTS "reservations_agency_read" ON reservations;
CREATE POLICY "reservations_agency_read" ON reservations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = 'agency'
        AND u.agency_id = reservations.agency_id
    )
  );

DROP POLICY IF EXISTS "reservations_agency_insert" ON reservations;

DROP POLICY IF EXISTS "reservations_superadmin_all" ON reservations;
CREATE POLICY "reservations_superadmin_all" ON reservations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

REVOKE INSERT ON public.reservations FROM anon;
REVOKE INSERT ON public.reservations FROM authenticated;

-- ============================================================
-- 8. RESERVATION_PASSENGERS
-- ============================================================

DROP POLICY IF EXISTS "rp_agency_read" ON reservation_passengers;
CREATE POLICY "rp_agency_read" ON reservation_passengers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = 'agency'
        AND reservation_id IN (
          SELECT id FROM reservations
          WHERE agency_id = u.agency_id
        )
    )
  );

DROP POLICY IF EXISTS "rp_superadmin_all" ON reservation_passengers;
CREATE POLICY "rp_superadmin_all" ON reservation_passengers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

-- ============================================================
-- 9. BOARDING_LOGS — eliminar INSERT cliente
-- ============================================================

DROP POLICY IF EXISTS "bl_agency_read" ON boarding_logs;
CREATE POLICY "bl_agency_read" ON boarding_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = 'agency'
        AND reservation_id IN (
          SELECT id FROM reservations
          WHERE agency_id = u.agency_id
        )
    )
  );

DROP POLICY IF EXISTS "bl_agency_insert" ON boarding_logs;

DROP POLICY IF EXISTS "bl_superadmin_all" ON boarding_logs;
CREATE POLICY "bl_superadmin_all" ON boarding_logs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

REVOKE INSERT ON public.boarding_logs FROM anon;
REVOKE INSERT ON public.boarding_logs FROM authenticated;

-- ============================================================
-- 10. NOTIFICATIONS (Realtime agency + superadmin)
-- ============================================================

DROP POLICY IF EXISTS "notifications_agency_select" ON notifications;
CREATE POLICY "notifications_agency_select" ON notifications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = 'agency'
        AND u.agency_id = notifications.agency_id
    )
  );

DROP POLICY IF EXISTS "notifications_agency_update" ON notifications;
CREATE POLICY "notifications_agency_update" ON notifications
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = 'agency'
        AND u.agency_id = notifications.agency_id
    )
  );

DROP POLICY IF EXISTS "notifications_superadmin_select" ON notifications;
CREATE POLICY "notifications_superadmin_select" ON notifications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

DROP POLICY IF EXISTS "notifications_superadmin_update" ON notifications;
CREATE POLICY "notifications_superadmin_update" ON notifications
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

-- ============================================================
-- 11. AGENCY NOTIFICATION PREFERENCES
-- ============================================================

DROP POLICY IF EXISTS "agency_notif_prefs_select" ON agency_notification_preferences;
CREATE POLICY "agency_notif_prefs_select" ON agency_notification_preferences
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = 'agency'
        AND u.agency_id = agency_notification_preferences.agency_id
    )
  );

DROP POLICY IF EXISTS "superadmin_notif_prefs_select" ON agency_notification_preferences;
CREATE POLICY "superadmin_notif_prefs_select" ON agency_notification_preferences
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'superadmin'
    )
  );

-- ============================================================
-- 12. AGENCY_INVITATIONS (condicional — tabla legacy opcional)
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.agency_invitations') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "invitations_superadmin_all" ON agency_invitations';
    EXECUTE $policy$
      CREATE POLICY "invitations_superadmin_all" ON agency_invitations
        FOR ALL USING (
          EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid() AND u.role = 'superadmin'
          )
        )
    $policy$;

    -- ai_public_read: no existe en migraciones del repo; no se modifica.
  END IF;
END $$;

-- ============================================================
-- Validación post-migración (ejecutar manualmente en SQL Editor)
-- ============================================================
--
-- A) Ninguna policy activa debe referenciar user_metadata:
-- SELECT schemaname, tablename, policyname, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND (qual::text ILIKE '%user_metadata%' OR with_check::text ILIKE '%user_metadata%');
-- → 0 filas
--
-- B) seats_auth_update eliminada:
-- SELECT policyname FROM pg_policies
-- WHERE tablename = 'seats' AND policyname = 'seats_auth_update';
-- → 0 filas
--
-- C) INSERT cliente eliminado:
-- SELECT policyname FROM pg_policies
-- WHERE policyname IN ('reservations_agency_insert', 'bl_agency_insert');
-- → 0 filas
--
-- D) Lecturas públicas Realtime intactas:
-- SELECT policyname FROM pg_policies
-- WHERE policyname IN (
--   'seats_public_read', 'trips_public_read', 'routes_public_read',
--   'ta_public_read', 'agencies_public_read'
-- );
-- → 5 filas
--
-- E) Forjar metadata no eleva privilegios RLS (con sesión agency autenticada):
-- await supabase.auth.updateUser({ data: { role: 'superadmin' } });
-- SELECT count(*) FROM agencies; -- solo activas vía public_read, no ALL
-- SELECT count(*) FROM reservations; -- solo filas de su agencia vía DB role
