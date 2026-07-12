-- 1. RUTAS
CREATE TABLE routes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. VIAJES
CREATE TABLE trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
  departure_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ASIENTOS POR VIAJE
CREATE TABLE seats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  seat_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' 
    CHECK (status IN ('available', 'reserved', 'locked')),
  locked_by UUID REFERENCES auth.users(id),
  locked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(trip_id, seat_code)
);

-- 4. RESERVAS
CREATE TABLE bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  seat_id UUID REFERENCES seats(id) ON DELETE CASCADE,
  passenger_name TEXT NOT NULL,
  passenger_email TEXT NOT NULL,
  qr_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' 
    CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. ÍNDICES DE PERFORMANCE
CREATE INDEX idx_seats_trip_id ON seats(trip_id);
CREATE INDEX idx_bookings_user_id ON bookings(user_id);
CREATE INDEX idx_bookings_trip_id ON bookings(trip_id);
CREATE INDEX idx_trips_departure ON trips(departure_at);

-- 6. UPDATED_AT automático
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER seats_updated_at
  BEFORE UPDATE ON seats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 7. ROW LEVEL SECURITY
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- ROUTES
CREATE POLICY "routes_public_read" ON routes FOR SELECT USING (true);
CREATE POLICY "routes_admin_write" ON routes FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- TRIPS
CREATE POLICY "trips_public_read" ON trips FOR SELECT USING (true);
CREATE POLICY "trips_admin_write" ON trips FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- SEATS
CREATE POLICY "seats_public_read" ON seats FOR SELECT USING (true);
CREATE POLICY "seats_auth_update" ON seats FOR UPDATE
  USING (auth.role() = 'authenticated');
CREATE POLICY "seats_admin_all" ON seats FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- BOOKINGS
CREATE POLICY "bookings_own" ON bookings FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "bookings_insert_auth" ON bookings FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bookings_admin_all" ON bookings FOR ALL
  USING (auth.jwt() ->> 'role' = 'admin');

-- 8. REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE seats;
