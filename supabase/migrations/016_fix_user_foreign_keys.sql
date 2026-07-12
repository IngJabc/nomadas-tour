-- ============================================================
-- 016_fix_user_foreign_keys.sql
-- Las FKs de columnas que almacenan req.ctx.userId (auth.users.id)
-- apuntaban incorrectamente a public.users(id).
-- Se corrigen para que apunten a auth.users(id).
-- ============================================================

-- 1. trips.created_by → auth.users(id)
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_created_by_fkey;
ALTER TABLE trips ADD CONSTRAINT trips_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id);

-- 2. seats.locked_by → auth.users(id)
ALTER TABLE seats DROP CONSTRAINT IF EXISTS seats_locked_by_fkey;
ALTER TABLE seats ADD CONSTRAINT seats_locked_by_fkey
  FOREIGN KEY (locked_by) REFERENCES auth.users(id);

-- 3. reservations.created_by → auth.users(id)
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_created_by_fkey;
ALTER TABLE reservations ADD CONSTRAINT reservations_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id);

-- 4. boarding_logs.scanned_by → auth.users(id)
ALTER TABLE boarding_logs DROP CONSTRAINT IF EXISTS boarding_logs_scanned_by_fkey;
ALTER TABLE boarding_logs ADD CONSTRAINT boarding_logs_scanned_by_fkey
  FOREIGN KEY (scanned_by) REFERENCES auth.users(id);

-- 5. users.id → auth.users(id) (recomendado para que lookups como
--    "users(id).eq(req.ctx.userId)" funcionen correctamente)
--    Usamos NOT VALID para no fallar con registros existentes cuyo
--    id no exista en auth.users (ej: superadmin sin public.users row).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_fkey;
ALTER TABLE users ADD CONSTRAINT users_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
