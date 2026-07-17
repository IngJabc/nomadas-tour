-- Agregar.failed_attempts para protección contra fuerza bruta.
-- Cuando un código alcanza 5 intentos fallidos, se bloquea definitivamente.

ALTER TABLE password_resets
  ADD COLUMN failed_attempts INT NOT NULL DEFAULT 0;
