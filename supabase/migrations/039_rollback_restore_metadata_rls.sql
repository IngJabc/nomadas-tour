-- ============================================================
-- 039_rollback_restore_metadata_rls.sql
-- Rollback completo de 039_rls_identity_from_public_users_v2.sql
--
-- Restaura el estado exacto post-038 (policies user_metadata + helpers eliminados).
-- Usar si STEP A o STEP B de 039 rompe Realtime o produce 42P17.
--
-- Orden:
--   1) Ejecutar este archivo completo
--   2) Cerrar sesión en app + hard refresh
--   3) Validar Realtime
-- ============================================================

-- ============================================================
-- 1. Eliminar helpers private.* (039 PART 1)
-- ============================================================

REVOKE USAGE ON SCHEMA private FROM authenticated;
REVOKE USAGE ON SCHEMA private FROM service_role;

DROP FUNCTION IF EXISTS private.auth_app_role();
DROP FUNCTION IF EXISTS private.auth_app_agency_id();

-- Schema private se conserva vacío (idempotente)

-- ============================================================
-- 2. AGENCIES (038 / 019 + 027)
-- ============================================================

DROP POLICY IF EXISTS "agencies_superadmin_all" ON public.agencies;
CREATE POLICY "agencies_superadmin_all" ON public.agencies
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

DROP POLICY IF EXISTS "agencies_own_read" ON public.agencies;
CREATE POLICY "agencies_own_read" ON public.agencies
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

-- agencies_public_read — sin cambios

-- ============================================================
-- 3. ROUTES (038)
-- ============================================================

DROP POLICY IF EXISTS "routes_superadmin_all" ON public.routes;
CREATE POLICY "routes_superadmin_all" ON public.routes
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- routes_public_read — sin cambios

-- ============================================================
-- 4. USERS (038)
-- ============================================================

DROP POLICY IF EXISTS "users_own_read" ON public.users;

DROP POLICY IF EXISTS "users_agency_read" ON public.users;
CREATE POLICY "users_agency_read" ON public.users
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "users_superadmin_all" ON public.users;
CREATE POLICY "users_superadmin_all" ON public.users
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- ============================================================
-- 5. TRIPS (038)
-- ============================================================

DROP POLICY IF EXISTS "trips_superadmin_all" ON public.trips;
CREATE POLICY "trips_superadmin_all" ON public.trips
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- trips_public_read — sin cambios

-- ============================================================
-- 6. SEATS (038)
-- ============================================================

DROP POLICY IF EXISTS "seats_superadmin_all" ON public.seats;
CREATE POLICY "seats_superadmin_all" ON public.seats
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

DROP POLICY IF EXISTS "seats_auth_update" ON public.seats;
CREATE POLICY "seats_auth_update" ON public.seats
  FOR UPDATE USING (auth.role() = 'authenticated');

-- seats_public_read — sin cambios

GRANT UPDATE ON public.seats TO authenticated;
GRANT UPDATE ON public.seats TO anon;

-- ============================================================
-- 7. TRIP_AGENCIES (038)
-- ============================================================

DROP POLICY IF EXISTS "ta_superadmin_all" ON public.trip_agencies;
CREATE POLICY "ta_superadmin_all" ON public.trip_agencies
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- ta_public_read — sin cambios

-- ============================================================
-- 8. RESERVATIONS (038)
-- ============================================================

DROP POLICY IF EXISTS "reservations_agency_read" ON public.reservations;
CREATE POLICY "reservations_agency_read" ON public.reservations
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "reservations_agency_insert" ON public.reservations;
CREATE POLICY "reservations_agency_insert" ON public.reservations
  FOR INSERT WITH CHECK (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "reservations_superadmin_all" ON public.reservations;
CREATE POLICY "reservations_superadmin_all" ON public.reservations
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

GRANT INSERT ON public.reservations TO authenticated;
GRANT INSERT ON public.reservations TO anon;

-- ============================================================
-- 9. RESERVATION_PASSENGERS (038)
-- ============================================================

DROP POLICY IF EXISTS "rp_agency_read" ON public.reservation_passengers;
CREATE POLICY "rp_agency_read" ON public.reservation_passengers
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND reservation_id IN (
      SELECT id FROM public.reservations
      WHERE agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
    )
  );

DROP POLICY IF EXISTS "rp_superadmin_all" ON public.reservation_passengers;
CREATE POLICY "rp_superadmin_all" ON public.reservation_passengers
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- ============================================================
-- 10. BOARDING_LOGS (038)
-- ============================================================

DROP POLICY IF EXISTS "bl_agency_read" ON public.boarding_logs;
CREATE POLICY "bl_agency_read" ON public.boarding_logs
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND reservation_id IN (
      SELECT id FROM public.reservations
      WHERE agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
    )
  );

DROP POLICY IF EXISTS "bl_agency_insert" ON public.boarding_logs;
CREATE POLICY "bl_agency_insert" ON public.boarding_logs
  FOR INSERT WITH CHECK (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND reservation_id IN (
      SELECT id FROM public.reservations
      WHERE agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
    )
  );

DROP POLICY IF EXISTS "bl_superadmin_all" ON public.boarding_logs;
CREATE POLICY "bl_superadmin_all" ON public.boarding_logs
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

GRANT INSERT ON public.boarding_logs TO authenticated;
GRANT INSERT ON public.boarding_logs TO anon;

-- ============================================================
-- 11. NOTIFICATIONS (038)
-- ============================================================

DROP POLICY IF EXISTS "notifications_agency_select" ON public.notifications;
CREATE POLICY "notifications_agency_select" ON public.notifications
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "notifications_agency_update" ON public.notifications;
CREATE POLICY "notifications_agency_update" ON public.notifications
  FOR UPDATE USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "notifications_superadmin_select" ON public.notifications;
CREATE POLICY "notifications_superadmin_select" ON public.notifications
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin'
  );

DROP POLICY IF EXISTS "notifications_superadmin_update" ON public.notifications;
CREATE POLICY "notifications_superadmin_update" ON public.notifications
  FOR UPDATE USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin'
  );

-- ============================================================
-- 12. AGENCY NOTIFICATION PREFERENCES (038)
-- ============================================================

DROP POLICY IF EXISTS "agency_notif_prefs_select" ON public.agency_notification_preferences;
CREATE POLICY "agency_notif_prefs_select" ON public.agency_notification_preferences
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "superadmin_notif_prefs_select" ON public.agency_notification_preferences;
CREATE POLICY "superadmin_notif_prefs_select" ON public.agency_notification_preferences
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin'
  );

-- ============================================================
-- 13. AGENCY_INVITATIONS (038 + prod ai_superadmin)
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.agency_invitations') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "invitations_superadmin_all" ON public.agency_invitations';
    EXECUTE $policy$
      CREATE POLICY "invitations_superadmin_all" ON public.agency_invitations
        FOR ALL USING (
          auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin'
        )
    $policy$;

    -- Restaurar ai_superadmin_all solo si la policy existe en prod
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'agency_invitations'
        AND policyname = 'ai_superadmin_all'
    ) THEN
      EXECUTE 'DROP POLICY IF EXISTS "ai_superadmin_all" ON public.agency_invitations';
      -- ai_superadmin_all en prod no usaba user_metadata (A1 refs_user_metadata=false).
      -- Restaurar con metadata es rollback seguro hacia estado funcional conocido (038-like).
      EXECUTE $policy$
        CREATE POLICY "ai_superadmin_all" ON public.agency_invitations
          FOR ALL USING (
            auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin'
          )
      $policy$;
    END IF;
  END IF;
END $$;

-- ai_public_read — sin cambios (no modificada por 039)

-- ============================================================
-- Validación post-rollback
-- ============================================================
--
-- SELECT count(*) FROM pg_policies
-- WHERE schemaname = 'public' AND qual::text ILIKE '%private.auth_app%';
-- → 0
--
-- SELECT proname FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'private' AND proname LIKE 'auth_app%';
-- → 0 filas
--
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public' AND qual::text ILIKE '%user_metadata%'
-- ORDER BY tablename;
-- → policies auth restauradas
