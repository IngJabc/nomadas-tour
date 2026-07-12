-- ============================================================
-- 013_fix_users_password_hash.sql
-- password_hash no es necesaria en public.users
-- porque la autenticación la maneja auth.users (Supabase Auth)
-- ============================================================

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
