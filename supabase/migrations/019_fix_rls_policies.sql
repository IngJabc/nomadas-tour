-- ============================================================
-- 019_fix_rls_policies
-- Fecha: 2026-07-12
-- 
-- CORRECCIÓN: auth.jwt() ->> 'role' → auth.jwt() -> 'user_metadata' ->> 'role'
-- 
-- El claim "role" del JWT de Supabase Auth SIEMPRE es 'authenticated'
-- (es el rol de Postgres, no el rol de la aplicación).
-- El rol de aplicación se guarda en user_metadata.role.
-- 
-- Ver también: auth.jwt() ->> 'agency_id' → auth.jwt() -> 'user_metadata' ->> 'agency_id'
-- ============================================================

-- 1. agencies
DROP POLICY IF EXISTS "agencies_superadmin_all" ON agencies;
CREATE POLICY "agencies_superadmin_all" ON agencies
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- 2. routes
DROP POLICY IF EXISTS "routes_superadmin_all" ON routes;
CREATE POLICY "routes_superadmin_all" ON routes
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- 3. users
DROP POLICY IF EXISTS "users_agency_read" ON users;
CREATE POLICY "users_agency_read" ON users
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "users_superadmin_all" ON users;
CREATE POLICY "users_superadmin_all" ON users
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- 4. trips
DROP POLICY IF EXISTS "trips_superadmin_all" ON trips;
CREATE POLICY "trips_superadmin_all" ON trips
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- 5. seats
DROP POLICY IF EXISTS "seats_superadmin_all" ON seats;
CREATE POLICY "seats_superadmin_all" ON seats
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- 6. trip_agencies
DROP POLICY IF EXISTS "ta_superadmin_all" ON trip_agencies;
CREATE POLICY "ta_superadmin_all" ON trip_agencies
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- 7. reservations
DROP POLICY IF EXISTS "reservations_agency_read" ON reservations;
CREATE POLICY "reservations_agency_read" ON reservations
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "reservations_agency_insert" ON reservations;
CREATE POLICY "reservations_agency_insert" ON reservations
  FOR INSERT WITH CHECK (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );

DROP POLICY IF EXISTS "reservations_superadmin_all" ON reservations;
CREATE POLICY "reservations_superadmin_all" ON reservations
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- 8. reservation_passengers
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

-- 9. boarding_logs
DROP POLICY IF EXISTS "bl_agency_read" ON boarding_logs;
CREATE POLICY "bl_agency_read" ON boarding_logs
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND reservation_id IN (
      SELECT id FROM reservations
      WHERE agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
    )
  );

DROP POLICY IF EXISTS "bl_agency_insert" ON boarding_logs;
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
