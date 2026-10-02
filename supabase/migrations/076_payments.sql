-- ============================================================
-- 076_payments.sql
-- Unidad monetaria, comprobantes de pago y su asignacion por pasajero.
--
-- Por que nace la unidad monetaria:
--   business-rules seccion 3 define el saldo como
--     saldo(pax) = seat_price - SUM(allocations verificadas)
--   pero en TODO el schema de tour (001-073) no existe ninguna columna
--   de precio: routes solo tiene origin/destination y trips no tiene
--   ni un campo monetario. Sin esta migracion la formula no es calculable.
--
--   trips.seat_price                 -> precio vigente del viaje (editable por admin)
--   reservation_passengers.unit_price -> snapshot congelado al reservar
--   El saldo se calcula con el snapshot, no con trips.seat_price, para que
--   un cambio de precio posterior NO altere saldos ya pactados.
--
-- Modelo (business-rules secciones 3 y 4):
--   - Un comprobante puede cubrir N pasajeros -> payment_allocations.
--   - La verificacion/rechazo es por payment_id, NUNCA por reservation_id.
--   - NO existe tabla installments: el saldo se deriva.
--
-- Migracion marketplace 3 de 6 (074-079). Requiere 075.
-- IMPORTANTE: los valores monetarios son ENTEROS en centavos.
--
-- NO se toca: CHECK de seats.status, policies de agencia, RPCs de tour.
--
-- Dry-run:   BEGIN;  \i 076_payments.sql   ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) UNIDAD MONETARIA
-- ============================================================

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS seat_price INTEGER
  CHECK (seat_price IS NULL OR seat_price >= 0);

ALTER TABLE public.reservation_passengers
  ADD COLUMN IF NOT EXISTS unit_price INTEGER
  CHECK (unit_price IS NULL OR unit_price >= 0);

COMMENT ON COLUMN public.trips.seat_price IS
  'Precio por puesto del viaje en centavos (marketplace, 076+). NULL = no publicado.';
COMMENT ON COLUMN public.reservation_passengers.unit_price IS
  'Snapshot de trips.seat_price al momento de reservar, en centavos. Es la base del saldo.';

-- ============================================================
-- 2) PAYMENTS (comprobantes)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  reservation_id UUID NOT NULL
    REFERENCES public.reservations(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL
    REFERENCES public.agencies(id),
  customer_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,

  -- Texto libre a proposito: no enumerar proveedores aqui para no
  -- necesitar una migracion cada vez que se sume una pasarela.
  provider TEXT NOT NULL DEFAULT 'manual',
  external_reference TEXT,

  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'COP' CHECK (char_length(currency) = 3),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected')),
  proof_url TEXT,

  -- Idempotencia de negocio: una fila por envio de comprobante aceptado
  idempotency_key TEXT NOT NULL UNIQUE,

  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  rejection_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Un pago verificado no puede perder su verificador ni su fecha.
  CONSTRAINT payments_verified_fields_check CHECK (
    (status = 'verified' AND verified_at IS NOT NULL)
    OR status <> 'verified'
  )
);

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  payment_id UUID NOT NULL
    REFERENCES public.payments(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL
    REFERENCES public.reservations(id) ON DELETE CASCADE,
  reservation_passenger_id UUID NOT NULL
    REFERENCES public.reservation_passengers(id) ON DELETE CASCADE,

  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- El mismo comprobante no puede asignar dos veces al mismo pasajero.
  CONSTRAINT payment_allocations_unique UNIQUE (payment_id, reservation_passenger_id)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_payments_reservation_id
  ON public.payments (reservation_id);
CREATE INDEX IF NOT EXISTS idx_payments_agency_id
  ON public.payments (agency_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id
  ON public.payments (customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status
  ON public.payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_verified_at
  ON public.payments (verified_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_reservation_id
  ON public.payment_allocations (reservation_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_passenger_id
  ON public.payment_allocations (reservation_passenger_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_id
  ON public.payment_allocations (payment_id);

-- ============================================================
-- 3) RLS
--    El cliente lee sus propios pagos y asignaciones.
--    La escritura es EXCLUSIVA del backend (service_role).
-- ============================================================

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_customer_read" ON public.payments;
CREATE POLICY "payments_customer_read" ON public.payments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.reservations r
      WHERE r.id = payments.reservation_id
        AND r.customer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "payment_allocations_customer_read" ON public.payment_allocations;
CREATE POLICY "payment_allocations_customer_read" ON public.payment_allocations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.reservations r
      WHERE r.id = payment_allocations.reservation_id
        AND r.customer_id = auth.uid()
    )
  );

-- ============================================================
-- 4) SALDO DERIVADO (helper de solo lectura)
--    saldo = unit_price snapshot - SUM(allocations de pagos verificados)
--    Es STABLE y de solo lectura: no modifica nada.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reservation_passenger_balance(
  p_passenger_id UUID
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(rp.unit_price, 0) - COALESCE(SUM(pa.amount_cents), 0)
  FROM public.reservation_passengers rp
  LEFT JOIN public.payment_allocations pa
    ON pa.reservation_passenger_id = rp.id
  LEFT JOIN public.payments p
    ON p.id = pa.payment_id
   AND p.status = 'verified'
  WHERE rp.id = p_passenger_id
  GROUP BY rp.unit_price;
$$;

COMMENT ON FUNCTION public.reservation_passenger_balance(UUID) IS
  'Saldo en centavos de un pasajero: unit_price - allocations de pagos verificados. Solo lectura.';

-- ============================================================
-- 5) DOCUMENTACION
-- ============================================================

COMMENT ON TABLE public.payments IS
  'Comprobantes de pago del marketplace. La verificacion es por payment_id, nunca por reservation_id.';
COMMENT ON TABLE public.payment_allocations IS
  'Reparto de un comprobante entre N pasajeros. Base del saldo, de T-1 y de la comision por pasajero.';
COMMENT ON COLUMN public.payments.idempotency_key IS
  'Clave de idempotencia del envio del comprobante (obligatoria, unica).';
COMMENT ON COLUMN public.payment_allocations.reservation_passenger_id IS
  'Pasajero cubierto por este comprobante. Determina fully_paid (saldo 0).';