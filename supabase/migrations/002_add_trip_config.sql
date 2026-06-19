-- Agregar columnas de configuración del bus a trips
ALTER TABLE trips ADD COLUMN total_seats INTEGER NOT NULL DEFAULT 30;
ALTER TABLE trips ADD COLUMN decks INTEGER NOT NULL DEFAULT 1;

-- Actualizar CHECK de status si existe (no hace falta, ya está)
