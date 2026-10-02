-- ============================================================
-- 075_reservations_marketplace.sql
-- Agrega a public.reservations las columnas del flujo marketplace
-- y las policies que permiten al cliente leer sus propias reservas.
--
-- Contexto:
--   011_create_all.sql creo public.reservations (trip_id, agency_id,
--   created_by, booker_*, qr_code, status).
--   017_fix_reservation_status_check.sql fijo el CHECK de status en
--     ('confirmed','cancelled','partial','completed','boarded').
--   026_passenger_status_cancel.sql agrego el status por pasajero.
--   036/039 fijaron RLS usando identidad de public.users.
--
-- Migracion marketplace 2 de 6 (074-079). Requiere 074 (rol customer).
-- Fuente de verdad:
--   nomadas-tour-marketplace/docs/business-rules.md secciones 3, 10 y 11.
--
-- NO se toca: CHECK de seats.status, policies de agencia, RPCs de tour.
--
-- Dry-run:   BEGIN;  \i 075_reservations_marketplace.sql   ROLLBACK;
-- ============================================================

-- 1) Vinculo con el cliente del marketplace
--    created_by (de tour) NO se toca: sigue siendo "quien creo la reserva"
--    para el flujo interno. customer_id es el dueno comercial del marketplace.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS customer_id UUID
  REFERENCES public.users(id) ON DELETE SET NULL;

-- 2) Fuente de la reserva (business-rules seccion 10)
--    'internal'   -> flujo de agencias (nomadas-tour), NO se modifica aqui
--    'marketplace' -> flujo B2C de este repo
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'internal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public' AND rel.relname = 'reservations'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%source%'
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_source_check
      CHECK (source IN ('internal', 'marketplace'));
  END IF;
END
$$;

-- Backfill defensivo explicito (no depender solo del DEFAULT)
UPDATE public.reservations SET source = 'internal' WHERE source IS NULL;

-- 3) payment_status DERIVADO (business-rules seccion 3)
--    NO es fuente de verdad: se recalcula desde payment_allocations.
--    NULL en reservas internal (el concepto no aplica a agencies).
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS payment_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public' AND rel.relname = 'reservations'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%payment_status%'
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_payment_status_check
      CHECK (payment_status IN ('pending', 'partial', 'fully_paid', 'refunded', 'cancelled'));
  END IF;
END
$$;

-- 4) Estados persistidos del ciclo marketplace (business-rules seccion 11)
--    locked -> reserved -> (cancelled | completed)
--    Se AGREGAN valores; ninguno de los de tour se elimina ni se reordena,
--    para no romper cancel_agency_reservation ni boarding_toggle.
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'reservations'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.reservations DROP CONSTRAINT %I', v_name);
  END LOOP;
END
$$;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_status_check
  CHECK (status IN (
    'locked',      -- marketplace: asientos bloqueados, sin comprobante aun
    'reserved',    -- marketplace: comprobante en proceso
    'confirmed',   -- tour: reserva confirmada por agencia
    'cancelled',
    'partial',
    'completed',
    'boarded'
  ));

-- 5) Indices de lectura del marketplace
CREATE INDEX IF NOT EXISTS idx_reservations_customer_id
  ON public.reservations (customer_id);

CREATE INDEX IF NOT EXISTS idx_reservations_customer_created
  ON public.reservations (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reservations_source
  ON public.reservations (source);

-- 6) RLS: el cliente lee sus propias reservas; escritura solo por service_role
--    (el backend marketplace escribe con service_role, nunca desde el cliente).
--    Se respeta la convencion de nombres de tour: <tabla>_<rol>_<accion>.
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reservations_customer_read" ON public.reservations;

CREATE POLICY "reservations_customer_read" ON public.reservations
  FOR SELECT
  USING (customer_id = auth.uid());

-- 7) Documentacion
COMMENT ON COLUMN public.reservations.customer_id IS
  'Dueno comercial de la reserva marketplace. NULL en reservas internal.';
COMMENT ON COLUMN public.reservations.source IS
  'internal = flujo de agencias (nomadas-tour, no se modifica desde marketplace). marketplace = flujo B2C.';
COMMENT ON COLUMN public.reservations.payment_status IS
  'DERIVADO desde payment_allocations. NULL en reservas internal. No usar como fuente de verdad.';
COMMENT ON COLUMN public.reservations.status IS
  'locked/reserved = marketplace (074+). confirmed/partial/completed/boarded/cancelled = flujo tour.';