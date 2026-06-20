-- Agrupar reservas de una misma compra
ALTER TABLE bookings ADD COLUMN transaction_id TEXT;
CREATE INDEX idx_bookings_transaction_id ON bookings(transaction_id);
