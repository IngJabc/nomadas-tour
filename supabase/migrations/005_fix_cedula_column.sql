-- Fix: passenger_email was incorrectly used to store cédula data.
-- 1. Add passenger_cedula column
ALTER TABLE bookings ADD COLUMN passenger_cedula TEXT;

-- 2. Migrate existing data from passenger_email -> passenger_cedula
UPDATE bookings SET passenger_cedula = passenger_email;

-- 3. Drop passenger_email column (no longer needed; email is optional)
ALTER TABLE bookings DROP COLUMN passenger_email;

-- 4. Make passenger_cedula NOT NULL after migration
ALTER TABLE bookings ALTER COLUMN passenger_cedula SET NOT NULL;
