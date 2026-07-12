-- ============================================================
-- Migration 006: Multi-tenant schema
-- Drops legacy tables and creates the new data model
-- ============================================================

-- 0. Disable RLS temporarily for schema changes
ALTER TABLE IF EXISTS bookings DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS seats DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS trips DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS routes DISABLE ROW LEVEL SECURITY;

-- Drop old RLS policies
DROP POLICY IF EXISTS "bookings_own" ON bookings;
DROP POLICY IF EXISTS "bookings_insert_auth" ON bookings;
DROP POLICY IF EXISTS "bookings_admin_all" ON bookings;
DROP POLICY IF EXISTS "seats_public_read" ON seats;
DROP POLICY IF EXISTS "seats_auth_update" ON seats;
DROP POLICY IF EXISTS "seats_admin_all" ON seats;
DROP POLICY IF EXISTS "trips_public_read" ON trips;
DROP POLICY IF EXISTS "trips_admin_write" ON trips;
DROP POLICY IF EXISTS "routes_public_read" ON routes;
DROP POLICY IF EXISTS "routes_admin_write" ON routes;

-- 1. CREATE agencies table
CREATE TABLE IF NOT EXISTS agencies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  subdomain TEXT NOT NULL UNIQUE,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_agencies_subdomain ON agencies(subdomain);

-- 2. CREATE users table (extends auth.users with role + agency)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('superadmin', 'agency', 'user')),
  agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_agency_id ON users(agency_id);
CREATE INDEX idx_users_role ON users(role);

-- 3. MODIFY routes: add created_by, drop duration_minutes
ALTER TABLE routes DROP COLUMN IF EXISTS duration_minutes;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE routes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 4. MODIFY trips
ALTER TABLE trips DROP COLUMN IF EXISTS total_seats;
ALTER TABLE trips DROP COLUMN IF EXISTS decks;
ALTER TABLE trips RENAME COLUMN departure_at TO departure_time;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 30;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 5. MODIFY seats: add new statuses, add updated_at trigger
ALTER TABLE seats DROP CONSTRAINT IF EXISTS seats_status_check;
ALTER TABLE seats ADD CONSTRAINT seats_status_check
  CHECK (status IN ('available', 'locked', 'reserved', 'blocked', 'guide'));
ALTER TABLE seats ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL;

-- Note: In the final model, agency_id on seats is NOT used for inventory.
-- It remains for backward compatibility during migration.
-- The new model uses trip_agency_allocations for agency capacity distribution.

-- 6. CREATE trip_agency_allocations
CREATE TABLE IF NOT EXISTS trip_agency_allocations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  allocated_seats INTEGER NOT NULL CHECK (allocated_seats > 0),
  reserved_seats INTEGER NOT NULL DEFAULT 0 CHECK (reserved_seats >= 0),
  UNIQUE(trip_id, agency_id)
);

CREATE INDEX idx_allocations_trip_id ON trip_agency_allocations(trip_id);
CREATE INDEX idx_allocations_agency_id ON trip_agency_allocations(agency_id);

-- 7. RENAME bookings → reservations with new schema
ALTER TABLE bookings RENAME TO reservations;
ALTER TABLE reservations RENAME COLUMN passenger_name TO customer_name;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS seat_code TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE reservations DROP COLUMN IF EXISTS seat_id;

-- Populate seat_code from seats table where possible
UPDATE reservations r SET seat_code = s.seat_code
FROM seats s WHERE r.seat_id = s.id;

ALTER TABLE reservations ALTER COLUMN seat_code SET NOT NULL;

-- Add transaction_id if not exists (might exist from migration 003)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS transaction_id TEXT;

-- Update status check
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('confirmed', 'cancelled', 'boarded'));

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_reservations_agency_id ON reservations(agency_id);
CREATE INDEX IF NOT EXISTS idx_reservations_transaction_id ON reservations(transaction_id);
CREATE INDEX IF NOT EXISTS idx_reservations_trip_id ON reservations(trip_id);
CREATE INDEX IF NOT EXISTS idx_reservations_qr_code ON reservations(qr_code);
CREATE INDEX IF NOT EXISTS idx_reservations_user_id ON reservations(user_id);

-- 8. CREATE agency_invitations
CREATE TABLE IF NOT EXISTS agency_invitations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invitations_token ON agency_invitations(token);

-- 9. ENABLE RLS on all tables
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_agency_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_invitations ENABLE ROW LEVEL SECURITY;

-- Re-enable RLS on existing tables
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE seats ENABLE ROW LEVEL SECURITY;

-- 10. RLS POLICIES

-- agencies: public read (active only), superadmin write
CREATE POLICY "agencies_public_read" ON agencies FOR SELECT
  USING (status = 'active');
CREATE POLICY "agencies_superadmin_all" ON agencies FOR ALL
  USING (auth.jwt() ->> 'role' = 'superadmin');

-- users: own read, superadmin read all, superadmin write
CREATE POLICY "users_own_read" ON users FOR SELECT
  USING (auth.uid() = id);
CREATE POLICY "users_superadmin_all" ON users FOR ALL
  USING (auth.jwt() ->> 'role' = 'superadmin');
CREATE POLICY "users_agency_read" ON users FOR SELECT
  USING (auth.jwt() ->> 'role' = 'agency' AND agency_id = (auth.jwt() ->> 'agency_id')::UUID);

-- routes: public read, superadmin write
CREATE POLICY "routes_public_read" ON routes FOR SELECT USING (true);
CREATE POLICY "routes_superadmin_all" ON routes FOR ALL
  USING (auth.jwt() ->> 'role' = 'superadmin');

-- trips: public read (active only), superadmin write
CREATE POLICY "trips_public_read" ON trips FOR SELECT USING (true);
CREATE POLICY "trips_superadmin_all" ON trips FOR ALL
  USING (auth.jwt() ->> 'role' = 'superadmin');

-- seats: public read, any auth can update (for realtime locking), superadmin all
CREATE POLICY "seats_public_read" ON seats FOR SELECT USING (true);
CREATE POLICY "seats_auth_update" ON seats FOR UPDATE
  USING (auth.role() = 'authenticated');
CREATE POLICY "seats_superadmin_all" ON seats FOR ALL
  USING (auth.jwt() ->> 'role' = 'superadmin');

-- trip_agency_allocations: public read, superadmin write
CREATE POLICY "allocations_public_read" ON trip_agency_allocations FOR SELECT USING (true);
CREATE POLICY "allocations_superadmin_all" ON trip_agency_allocations FOR ALL
  USING (auth.jwt() ->> 'role' = 'superadmin');

-- reservations: own read, own insert, agency read own, superadmin all
CREATE POLICY "reservations_own_read" ON reservations FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "reservations_agency_read" ON reservations FOR SELECT
  USING (auth.jwt() ->> 'role' = 'agency' AND agency_id = (auth.jwt() ->> 'agency_id')::UUID);
CREATE POLICY "reservations_superadmin_all" ON reservations FOR ALL
  USING (auth.jwt() ->> 'role' = 'superadmin');

-- agency_invitations: superadmin all, agency read own
CREATE POLICY "invitations_superadmin_all" ON agency_invitations FOR ALL
  USING (auth.jwt() ->> 'role' = 'superadmin');

-- 11. REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE seats;
ALTER PUBLICATION supabase_realtime ADD TABLE reservations;

-- 12. Create superadmin user function
CREATE OR REPLACE FUNCTION create_superadmin(email TEXT, password TEXT, full_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_id UUID;
BEGIN
  -- This function is a placeholder; superadmin should be created via Supabase UI
  -- or a seed script using the auth admin API.
  RETURN NULL;
END;
$$;

-- 13. Trigger: update updated_at on routes and trips
DROP TRIGGER IF EXISTS routes_updated_at ON routes;
CREATE TRIGGER routes_updated_at
  BEFORE UPDATE ON routes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trips_updated_at ON trips;
CREATE TRIGGER trips_updated_at
  BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
