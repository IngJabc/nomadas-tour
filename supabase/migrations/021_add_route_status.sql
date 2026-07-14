-- 021_add_route_status.sql
-- Agrega columna status a la tabla routes para soportar activar/desactivar rutas.

-- Agregar columna status con valor por defecto 'active'
ALTER TABLE routes
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'inactive'));

-- Todas las rutas existentes quedan activas por defecto (ya garantizado por el DEFAULT)
-- Crear índice para filtrado eficiente por status
CREATE INDEX idx_routes_status ON routes(status);
