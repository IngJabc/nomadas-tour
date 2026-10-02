-- ============================================================
-- 078_trips_installments.sql
-- Configuracion de abono por viaje.
--
-- Contexto de negocio (business-rules marketplace seccion 3):
--   NO existe una tabla installments. El saldo siempre se deriva de
--   payment_allocations. Lo unico que se configura por viaje es si se
--   PERMITE pagar un abono y de cuanto es.
--
--   - installment_allowed = false  -> solo pago total
--   - installment_allowed = true   -> se admite un abono parcial de
--                                     installment_amount_cents
--
-- Migracion marketplace 5 de 6 (074-079). Requiere 076 (trips.seat_price).
--
-- NO se toca: logica de pagos de tour ni sus columnas.
--
-- Dry-run:   BEGIN;  \i 078_trips_installments.sql   ROLLBACK;
-- ============================================================

-- 1) Flags de abono
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS installment_allowed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS installment_amount_cents INTEGER;

-- 2) Coherencia: no puede existir monto de abono si el abono no esta permitido.
--    Regla complementaria (installment_amount_cents < trips.seat_price) NO se
--    fuerza con CHECK porque un CHECK no puede leer otra tabla de la misma fila;
--    se valida en el panel admin (P9) y no como trigger, para no agregar
--    triggers sobre public.trips que tambien escribe nomadas-tour.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'trips'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%installment%'
  ) THEN
    ALTER TABLE public.trips
      ADD CONSTRAINT trips_installment_coherence_check
      CHECK (installment_allowed OR installment_amount_cents IS NULL);
  END IF;
END
$$;

ALTER TABLE public.trips
  DROP CONSTRAINT IF EXISTS trips_installment_amount_positive_check;

ALTER TABLE public.trips
  ADD CONSTRAINT trips_installment_amount_positive_check
  CHECK (installment_amount_cents IS NULL OR installment_amount_cents > 0);

-- 3) Documentacion
COMMENT ON COLUMN public.trips.installment_allowed IS
  'true = el viaje admite abono parcial (marketplace, 078+). false = solo pago total.';
COMMENT ON COLUMN public.trips.installment_amount_cents IS
  'Monto del abono en centavos. NULL = sin abono. Debe ser < trips.seat_price.';