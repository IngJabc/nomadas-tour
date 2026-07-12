-- ============================================================
-- 010_drop_all.sql
-- Elimina todo el schema actual para reconstruir desde cero.
-- Orden seguro: primero publicaciones, luego policies, triggers,
-- funciones, y finalmente tablas en orden inverso de dependencias.
-- ============================================================

-- A1. REMOVE FROM REALTIME
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS seats;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS reservations;

-- A2. DROP RLS POLICIES
DROP POLICY IF EXISTS "agencies_public_read" ON agencies;
DROP POLICY IF EXISTS "agencies_superadmin_all" ON agencies;
DROP POLICY IF EXISTS "users_own_read" ON users;
DROP POLICY IF EXISTS "users_superadmin_all" ON users;
DROP POLICY IF EXISTS "users_agency_read" ON users;
DROP POLICY IF EXISTS "routes_public_read" ON routes;
DROP POLICY IF EXISTS "routes_superadmin_all" ON routes;
DROP POLICY IF EXISTS "trips_public_read" ON trips;
DROP POLICY IF EXISTS "trips_superadmin_all" ON trips;
DROP POLICY IF EXISTS "seats_public_read" ON seats;
DROP POLICY IF EXISTS "seats_auth_update" ON seats;
DROP POLICY IF EXISTS "seats_superadmin_all" ON seats;
DROP POLICY IF EXISTS "allocations_public_read" ON trip_agency_allocations;
DROP POLICY IF EXISTS "allocations_superadmin_all" ON trip_agency_allocations;
DROP POLICY IF EXISTS "reservations_own_read" ON reservations;
DROP POLICY IF EXISTS "reservations_agency_read" ON reservations;
DROP POLICY IF EXISTS "reservations_superadmin_all" ON reservations;
DROP POLICY IF EXISTS "invitations_superadmin_all" ON agency_invitations;

-- A3. DROP TRIGGERS
DROP TRIGGER IF EXISTS seats_updated_at ON seats;
DROP TRIGGER IF EXISTS routes_updated_at ON routes;
DROP TRIGGER IF EXISTS trips_updated_at ON trips;

-- A4. DROP FUNCTION
DROP FUNCTION IF EXISTS create_superadmin;

-- A5. DISABLE RLS (para poder dropear)
ALTER TABLE IF EXISTS agencies DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS routes DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS trips DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS seats DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS trip_agency_allocations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS reservations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS agency_invitations DISABLE ROW LEVEL SECURITY;

-- A6. DROP TABLES (orden inverso de dependencias)
DROP TABLE IF EXISTS boarding_logs;
DROP TABLE IF EXISTS reservation_passengers;
DROP TABLE IF EXISTS reservations;
DROP TABLE IF EXISTS trip_agency_allocations;
DROP TABLE IF EXISTS seats;
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS routes;
DROP TABLE IF EXISTS agency_invitations;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS agencies;
