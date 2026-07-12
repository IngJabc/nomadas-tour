-- ============================================================
-- 018_boarding_agency_audit.sql
-- Agrega columnas de auditoría a boarding_logs para registrar
-- qué agencia realizó el escaneo y a qué pasajero individual.
-- ============================================================

ALTER TABLE boarding_logs
  ADD COLUMN scanned_by_agency_id UUID REFERENCES agencies(id),
  ADD COLUMN reservation_passenger_id UUID REFERENCES reservation_passengers(id);

CREATE INDEX IF NOT EXISTS idx_bl_scanned_by_agency ON boarding_logs(scanned_by_agency_id);
CREATE INDEX IF NOT EXISTS idx_bl_passenger ON boarding_logs(reservation_passenger_id);
