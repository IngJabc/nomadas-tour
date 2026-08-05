-- ============================================================
-- 045_boarding_attempts.sql
-- AUD-020 P1 / M3 — Operational attempt telemetry (not business truth).
--
-- Rules:
--   - Never store QR, ticket_code, documents, or full payloads
--   - credential_hash = server-side hash only (nullable)
--   - No Realtime publication
--   - No client RLS policies yet (RLS enabled = deny by default)
--   - Retention: 90 days recommended (purge job is an ops follow-up)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.boarding_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  actor_user_id UUID NULL REFERENCES public.users(id),
  operator_agency_id UUID NULL REFERENCES public.agencies(id),

  trip_id UUID NULL REFERENCES public.trips(id),
  reservation_id UUID NULL REFERENCES public.reservations(id),
  reservation_passenger_id UUID NULL REFERENCES public.reservation_passengers(id),

  operation TEXT NOT NULL
    CHECK (operation IN ('lookup', 'board', 'unboard')),

  outcome TEXT NOT NULL
    CHECK (outcome IN ('success', 'no_change', 'denied', 'not_found', 'error')),

  failure_code TEXT NULL,
  credential_hash TEXT NULL
);

COMMENT ON TABLE public.boarding_attempts IS
  'Operational boarding attempt telemetry. Distinct from boarding_logs (real transitions). Retention target: 90 days. No plaintext credentials.';

COMMENT ON COLUMN public.boarding_attempts.credential_hash IS
  'SHA-256 of normalized lookup input only. Never store QR/ticket_code plaintext.';

CREATE INDEX IF NOT EXISTS idx_ba_created_at
  ON public.boarding_attempts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ba_operator_agency_id
  ON public.boarding_attempts (operator_agency_id);

CREATE INDEX IF NOT EXISTS idx_ba_trip_id
  ON public.boarding_attempts (trip_id);

CREATE INDEX IF NOT EXISTS idx_ba_outcome
  ON public.boarding_attempts (outcome);

-- Deny client access by default; service_role bypasses RLS
ALTER TABLE public.boarding_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.boarding_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.boarding_attempts FROM anon;
REVOKE ALL ON TABLE public.boarding_attempts FROM authenticated;

GRANT SELECT, INSERT ON TABLE public.boarding_attempts TO service_role;

-- Explicitly do NOT add to supabase_realtime
