-- ============================================================
-- 077_platform_config_commissions_refunds.sql
-- Configuracion global, comisiones por pasajero y refunds de cliente.
--
-- Contexto de negocio (business-rules marketplace):
--   seccion 5 - Los refunds de clientes viven en reservation_refunds.
--               agency_ledger SOLO registra Nomadas <-> Agencia.
--   seccion 8 - Comision por PASAJERO, no por reserva. Se dispara con
--               trip.completed. Idempotencia por trip_id + passenger_id.
--               NO depende de boarded ni de reservations.payment_status:
--               usa el saldo real (allocations verificadas).
--   seccion 9 - Primer viaje gratis: TODA la operacion de la agencia en
--               ese viaje queda exenta, marcada con kind='first_trip_waiver'.
--
-- Migracion marketplace 4 de 6 (074-079). Requiere 076.
-- IMPORTANTE: los valores monetarios son ENTEROS en centavos.
--
-- NO se toca: agency_ledger (es de tour), policies de tour.
--
-- Dry-run:   BEGIN;  \i 077_platform_config_commissions_refunds.sql   ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) CONFIGURACION GLOBAL
--    Clave/valor flexible para no migrar el schema por cada parametro.
--    convention: key = nombre del parametro, value = JSONB.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_config IS
  'Parametros globales de la plataforma. value es JSONB. Ej: marketplace_commission_fee_cents.';

-- Fee por defecto: 30 centavos por pasajero (business-rules seccion 8).
INSERT INTO public.platform_config (key, value)
VALUES ('marketplace_commission_fee_cents', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2) COMISIONES POR PASAJERO
-- ============================================================

CREATE TABLE IF NOT EXISTS public.commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  trip_id UUID NOT NULL
    REFERENCES public.trips(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL
    REFERENCES public.reservations(id) ON DELETE CASCADE,
  reservation_passenger_id UUID NOT NULL
    REFERENCES public.reservation_passengers(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL
    REFERENCES public.agencies(id),

  -- commission_charge = cobrar comision
  -- first_trip_waiver  = primer viaje gratis de la agencia (exencion)
  kind TEXT NOT NULL
    CHECK (kind IN ('commission_charge', 'first_trip_waiver')),

  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),

  -- Fee aplicado en el momento: es el historico, no se relee de platform_config
  fee_cents INTEGER CHECK (fee_cents IS NULL OR fee_cents >= 0),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'void')),

  -- Idempotencia: trip_id + passenger_id (business-rules seccion 8)
  idempotency_key TEXT NOT NULL UNIQUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ,

  CONSTRAINT commissions_waiver_no_amount_check CHECK (
    kind <> 'first_trip_waiver' OR amount_cents = 0
  )
);

CREATE INDEX IF NOT EXISTS idx_commissions_trip_id
  ON public.commissions (trip_id);
CREATE INDEX IF NOT EXISTS idx_commissions_reservation_id
  ON public.commissions (reservation_id);
CREATE INDEX IF NOT EXISTS idx_commissions_passenger_id
  ON public.commissions (reservation_passenger_id);
CREATE INDEX IF NOT EXISTS idx_commissions_agency_status
  ON public.commissions (agency_id, status);

-- ============================================================
-- 3) FLAG DE PRIMER VIAJE GRATIS (business-rules seccion 9)
--    Marca de tiempo en la agencia, para que la exencion sea atomica
--    e idempotente por trip_id + agency_id.
--    Solo se escribe cuando el viaje se completa, no al crear la reserva.
-- ============================================================

ALTER TABLE public.agencies
  ADD COLUMN IF NOT EXISTS first_marketplace_trip_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.agencies.first_marketplace_trip_completed_at IS
  'Primer viaje marketplace completado por la agencia. NULL = nunca completo uno. Base de first_trip_waiver.';

-- ============================================================
-- 4) REFUNDS DE CLIENTE (business-rules seccion 5)
--    NO toca agency_ledger: ese ledger es solo Nomadas <-> Agencia.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reservation_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  reservation_id UUID NOT NULL
    REFERENCES public.reservations(id) ON DELETE CASCADE,

  -- El refund puede ser de un pasajero concreto o de la reserva completa.
  reservation_passenger_id UUID
    REFERENCES public.reservation_passengers(id) ON DELETE CASCADE,

  payment_id UUID
    REFERENCES public.payments(id) ON DELETE SET NULL,

  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  reason TEXT NOT NULL,

  -- required  = marcado por cancel_reservation_passenger (079), aun sin tratar
  -- pending   = en gestion
  -- completed = devuelto
  -- rejected  = no corresponde devolver
  status TEXT NOT NULL DEFAULT 'required'
    CHECK (status IN ('required', 'pending', 'completed', 'rejected')),

  idempotency_key TEXT NOT NULL UNIQUE,

  requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reservation_refunds_reservation_id
  ON public.reservation_refunds (reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_refunds_passenger_id
  ON public.reservation_refunds (reservation_passenger_id);
CREATE INDEX IF NOT EXISTS idx_reservation_refunds_status
  ON public.reservation_refunds (status);

-- ============================================================
-- 5) RLS
--    El cliente ve los refunds que le afectan. Escritura: service_role.
-- ============================================================

ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reservation_refunds_customer_read" ON public.reservation_refunds;
CREATE POLICY "reservation_refunds_customer_read" ON public.reservation_refunds
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.reservations r
      WHERE r.id = reservation_refunds.reservation_id
        AND r.customer_id = auth.uid()
    )
  );

-- commissions NO tiene policy de cliente: es informacion interna
-- Nomadas <-> Agencia. Solo service_role y superadmin (via backend).

-- ============================================================
-- 6) DOCUMENTACION
-- ============================================================

COMMENT ON TABLE public.commissions IS
  'Comision por pasajero. Se genera con trip.completed. kind=first_trip_waiver marca el primer viaje gratis de la agencia.';
COMMENT ON COLUMN public.commissions.fee_cents IS
  'Fee aplicado en el momento de generar la comision (historico, no se relee de platform_config).';
COMMENT ON TABLE public.reservation_refunds IS
  'Refunds a cliente. NO se registra en agency_ledger (ese es solo Nomadas <-> Agencia).';