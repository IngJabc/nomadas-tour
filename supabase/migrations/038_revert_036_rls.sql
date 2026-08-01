-- ============================================================
-- 038_revert_036_rls.sql
-- Rollback de 036_rls_identity_from_public_users.sql
--
-- Restaura el estado RLS previo a FASE 2 (políticas basadas en
-- auth.jwt()->user_metadata, como en 019 / 027 / 029 / 032 / 011).
--
-- Ejecutar en SQL Editor si 036 ya fue aplicada y Realtime dejó
-- de funcionar. No modifica publicaciones ni canales Realtime.
-- ============================================================

-- ============================================================
-- 1. AGENCIES (019 + 027)
-- ============================================================

DROP POLICY IF EXISTS "agencies_superadmin_all" ON agencies;
CREATE POLICY "agencies_superadmin_all" ON agencies
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

DROP POLICY IF EXISTS "agencies_own_read" ON agencies;
CREATE POLICY "agencies_own_read" ON agencies
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

-- agencies_public_read — sin cambios

-- ============================================================
-- 2. ROUTES (019)
-- ============================================================

DROP POLICY IF EXISTS "routes_superadmin_all" ON routes;
CREATE POLICY "routes_superadmin_all" ON routes
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- routes_public_read — sin cambios

-- ============================================================
-- 3. USERS (019) — quitar users_own_read añadida por 036
-- ============================================================

DROP POLICY IF EXISTS "users_own_read" ON users;

DROP POLICY IF EXISTS "users_agency_read" ON users;
CREATE POLICY "users_agency_read" ON users
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "users_superadmin_all" ON users;
CREATE POLICY "users_superadmin_all" ON users
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- ============================================================
-- 4. TRIPS (019)
-- ============================================================

DROP POLICY IF EXISTS "trips_superadmin_all" ON trips;
CREATE POLICY "trips_superadmin_all" ON trips
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- trips_public_read — sin cambios

-- ============================================================
-- 5. SEATS (019 + 011 seats_auth_update)
-- ============================================================

DROP POLICY IF EXISTS "seats_superadmin_all" ON seats;
CREATE POLICY "seats_superadmin_all" ON seats
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

CREATE POLICY "seats_auth_update" ON seats
  FOR UPDATE USING (auth.role() = 'authenticated');

-- seats_public_read — sin cambios

GRANT UPDATE ON public.seats TO authenticated;
GRANT UPDATE ON public.seats TO anon;

-- ============================================================
-- 6. TRIP_AGENCIES (019)
-- ============================================================

DROP POLICY IF EXISTS "ta_superadmin_all" ON trip_agencies;
CREATE POLICY "ta_superadmin_all" ON trip_agencies
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- ta_public_read — sin cambios

-- ============================================================
-- 7. RESERVATIONS (019)
-- ============================================================

DROP POLICY IF EXISTS "reservations_agency_read" ON reservations;
CREATE POLICY "reservations_agency_read" ON reservations
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

CREATE POLICY "reservations_agency_insert" ON reservations
  FOR INSERT WITH CHECK (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "reservations_superadmin_all" ON reservations;
CREATE POLICY "reservations_superadmin_all" ON reservations
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

GRANT INSERT ON public.reservations TO authenticated;
GRANT INSERT ON public.reservations TO anon;

-- ============================================================
-- 8. RESERVATION_PASSENGERS (019)
-- ============================================================

DROP POLICY IF EXISTS "rp_agency_read" ON reservation_passengers;
CREATE POLICY "rp_agency_read" ON reservation_passengers
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND reservation_id IN (
      SELECT id FROM reservations
      WHERE agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
    )
  );

DROP POLICY IF EXISTS "rp_superadmin_all" ON reservation_passengers;
CREATE POLICY "rp_superadmin_all" ON reservation_passengers
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- ============================================================
-- 9. BOARDING_LOGS (019)
-- ============================================================

DROP POLICY IF EXISTS "bl_agency_read" ON boarding_logs;
CREATE POLICY "bl_agency_read" ON boarding_logs
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND reservation_id IN (
      SELECT id FROM reservations
      WHERE agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
    )
  );

CREATE POLICY "bl_agency_insert" ON boarding_logs
  FOR INSERT WITH CHECK (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND reservation_id IN (
      SELECT id FROM reservations
      WHERE agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
    )
  );

DROP POLICY IF EXISTS "bl_superadmin_all" ON boarding_logs;
CREATE POLICY "bl_superadmin_all" ON boarding_logs
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

GRANT INSERT ON public.boarding_logs TO authenticated;
GRANT INSERT ON public.boarding_logs TO anon;

-- ============================================================
-- 10. NOTIFICATIONS (029)
-- ============================================================

DROP POLICY IF EXISTS "notifications_agency_select" ON notifications;
CREATE POLICY "notifications_agency_select" ON notifications
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "notifications_agency_update" ON notifications;
CREATE POLICY "notifications_agency_update" ON notifications
  FOR UPDATE USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "notifications_superadmin_select" ON notifications;
CREATE POLICY "notifications_superadmin_select" ON notifications
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin'
  );

DROP POLICY IF EXISTS "notifications_superadmin_update" ON notifications;
CREATE POLICY "notifications_superadmin_update" ON notifications
  FOR UPDATE USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin'
  );

-- ============================================================
-- 11. AGENCY NOTIFICATION PREFERENCES (032)
-- ============================================================

DROP POLICY IF EXISTS "agency_notif_prefs_select" ON agency_notification_preferences;
CREATE POLICY "agency_notif_prefs_select" ON agency_notification_preferences
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "superadmin_notif_prefs_select" ON agency_notification_preferences;
CREATE POLICY "superadmin_notif_prefs_select" ON agency_notification_preferences
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin'
  );

-- ============================================================
-- 12. AGENCY_INVITATIONS (condicional)
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.agency_invitations') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "invitations_superadmin_all" ON agency_invitations';
    EXECUTE $policy$
      CREATE POLICY "invitations_superadmin_all" ON agency_invitations
        FOR ALL USING (
          auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin'
        )
    $policy$;
  END IF;
END $$;

-- ============================================================
-- Validación post-rollback
-- ============================================================
--
-- 1) Policies de lectura pública intactas:
-- SELECT policyname FROM pg_policies
-- WHERE policyname IN (
--   'seats_public_read', 'trips_public_read', 'routes_public_read',
--   'ta_public_read', 'agencies_public_read'
-- );
--
-- 2) seats_auth_update restaurada:
-- SELECT policyname FROM pg_policies
-- WHERE tablename = 'seats' AND policyname = 'seats_auth_update';
--
-- 3) Tras ejecutar: cerrar sesión, volver a login, hard refresh.
--    Realtime requiere JWT con user_metadata.role/agency_id poblados.
