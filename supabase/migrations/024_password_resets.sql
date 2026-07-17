-- Tabla para códigos temporales de recuperación de contraseña.
-- code_hash: SHA-256 del código de 6 dígitos (nunca se almacena en texto plano)
-- token: UUID para link directo en el email (/reset-password?token=xxx)
-- used_at: NULL = activo, timestamp = invalidado/consumido

CREATE TABLE password_resets (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_password_resets_user_id ON password_resets(user_id);
CREATE INDEX idx_password_resets_token ON password_resets(token);
CREATE INDEX idx_password_resets_code_hash ON password_resets(code_hash);
