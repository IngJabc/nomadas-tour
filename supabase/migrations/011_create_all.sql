-- ============================================================
-- 011_create_all.sql
-- Reconstruye el schema completo desde cero.
-- Orden: function → agencies → routes → users → trips
-- → seats → trip_agencies → reservations → reservation_passengers
-- → boarding_logs → RLS → realtime
-- ============================================================

-- ============================================================
-- B1. FUNCTION: update_updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- B2. AGENCIES
-- ============================================================
CREATE TABLE agencies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  subdomain TEXT NOT NULL UNIQUE,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX idx_agencies_subdomain ON agencies(subdomain);

-- ============================================================
-- B3. ROUTES
-- ============================================================
CREATE TABLE routes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL
);

-- ============================================================
-- B4. USERS
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('superadmin', 'agency')),
  agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_agency_id ON users(agency_id);

-- ============================================================
-- B5. TRIPS
-- ============================================================
CREATE TABLE trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  departure_time TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  vehicle_type TEXT NOT NULL DEFAULT 'bus' CHECK (vehicle_type IN ('bus', 'kia')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'completed')),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_trips_departure ON trips(departure_time);
CREATE INDEX idx_trips_route_id ON trips(route_id);

-- ============================================================
-- B6. SEATS
-- ============================================================
CREATE TABLE seats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seat_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'locked', 'reserved', 'blocked', 'guide')),
  locked_by UUID REFERENCES auth.users(id),
  locked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(trip_id, seat_code)
);

CREATE INDEX idx_seats_trip_id ON seats(trip_id);

CREATE TRIGGER seats_updated_t
  BEFORE UPDATE ON seats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- B7. TRIP_AGENCIES (junction)
-- ============================================================
CREATE TABLE trip_agencies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  UNIQUE(trip_id, agency_id)
);

CREATE INDEX idx_ta_trip_id ON trip_agencies(trip_id);
CREATE INDEX idx_ta_agency_id ON trip_agencies(agency_id);

-- ============================================================
-- B8. RESERVATIONS (header de grupo)
-- ============================================================
CREATE TABLE reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES agencies(id),
  created_by UUID REFERENCES auth.users(id),
  booker_name TEXT NOT NULL,
  booker_document TEXT NOT NULL,
  booker_phone TEXT,
  qr_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled', 'partial', 'completed', 'boarded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reservations_trip_id ON reservations(trip_id);
CREATE INDEX idx_reservations_agency_id ON reservations(agency_id);
CREATE INDEX idx_reservations_qr_code ON reservations(qr_code);
CREATE INDEX idx_reservations_created_by ON reservations(created_by);

-- ============================================================
-- B9. RESERVATION_PASSENGERS
-- ============================================================
CREATE TABLE reservation_passengers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  seat_id UUID NOT NULL REFERENCES seats(id),
  name TEXT NOT NULL,
  document TEXT NOT NULL,
  phone TEXT,
  boarded BOOLEAN NOT NULL DEFAULT FALSE,
  boarded_at TIMESTAMPTZ
);

CREATE INDEX idx_rp_reservation_id ON reservation_passengers(reservation_id);
CREATE INDEX idx_rp_seat_id ON reservation_passengers(seat_id);
CREATE INDEX idx_rp_boarded ON reservation_passengers(boarded);

-- ============================================================
-- B10. BOARDING_LOGS
-- ============================================================
CREATE TABLE boarding_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  scanned_by UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL
    CHECK (action IN ('board', 'unboard', 'correction')),
  seat_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bl_reservation_id ON boarding_logs(reservation_id);
CREATE INDEX idx_bl_scanned_by ON boarding_logs(scanned_by);
CREATE INDEX idx_bl_created_at ON boarding_logs(created_at);

-- ============================================================
-- B11. RLS — ENABLE
-- ============================================================
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_passengers ENABLE ROW LEVEL SECURITY;
ALTER TABLE boarding_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- B12. RLS — POLICIES
-- ============================================================

-- AGENCIES: solo agencias activas visibles públicamente, superadmin todo
CREATE POLICY "agencies_public_read" ON agencies
  FOR SELECT USING (status = 'active');
CREATE POLICY "agencies_superadmin_all" ON agencies
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- ROUTES: lectura pública, superadmin todo
CREATE POLICY "routes_public_read" ON routes
  FOR SELECT USING (true);
CREATE POLICY "routes_superadmin_all" ON routes
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- USERS: agencia solo usuarios de su agencia, superadmin todo
CREATE POLICY "users_agency_read" ON users
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
  );
CREATE POLICY "users_superadmin_all" ON users
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- TRIPS: lectura pública, superadmin todo
CREATE POLICY "trips_public_read" ON trips
  FOR SELECT USING (true);
CREATE POLICY "trips_superadmin_all" ON trips
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- SEATS: lectura pública, agencia puede actualizar (locking), superadmin todo
CREATE POLICY "seats_public_read" ON seats
  FOR SELECT USING (true);
CREATE POLICY "seats_auth_update" ON seats
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "seats_superadmin_all" ON seats
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- TRIP_AGENCIES: lectura pública, superadmin todo
CREATE POLICY "ta_public_read" ON trip_agencies
  FOR SELECT USING (true);
CREATE POLICY "ta_superadmin_all" ON trip_agencies
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- RESERVATIONS: agencia solo las suyas, superadmin todo
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
CREATE POLICY "reservations_superadmin_all" ON reservations
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- RESERVATION_PASSENGERS: agencia solo pasajeros de sus reservas, superadmin todo
CREATE POLICY "rp_agency_read" ON reservation_passengers
  FOR SELECT USING (
    auth.jwt() -> 'user_metadata' ->> 'role' = 'agency'
    AND reservation_id IN (
      SELECT id FROM reservations
      WHERE agency_id = (auth.jwt() -> 'user_metadata' ->> 'agency_id')::UUID
    )
  );
CREATE POLICY "rp_superadmin_all" ON reservation_passengers
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- BOARDING_LOGS: agencia solo los suyos, superadmin todo
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
CREATE POLICY "bl_superadmin_all" ON boarding_logs
  FOR ALL USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'superadmin');

-- ============================================================
-- B13. REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE seats;
ALTER PUBLICATION supabase_realtime ADD TABLE boarding_logs;
