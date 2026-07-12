ALTER TABLE trips ADD COLUMN IF NOT EXISTS vehicle_type TEXT NOT NULL DEFAULT 'bus' CHECK (vehicle_type IN ('bus', 'kia'));
