-- ============================================================
-- 049_outbox_events.sql
-- WKR-004 — Transactional Outbox Foundation
--
-- Creates outbox_events + AFTER INSERT trigger on reservations
-- that emits reservation.created.v1 in the same transaction as
-- create_agency_reservation (no RPC/service changes).
--
-- Access: service_role only. Not in supabase_realtime.
-- Payload: no PII (no documents, phones, emails, QR).
-- ============================================================

-- ── 1) Table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  tenant_id UUID NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT outbox_events_event_version_positive
    CHECK (event_version >= 1),
  CONSTRAINT outbox_events_attempts_nonnegative
    CHECK (attempts >= 0),
  CONSTRAINT outbox_events_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT outbox_events_payload_object
    CHECK (jsonb_typeof(payload) = 'object')
);

COMMENT ON TABLE public.outbox_events IS
  'WKR-004 transactional outbox. Domain events for async workers. service_role only; not Realtime.';

COMMENT ON COLUMN public.outbox_events.tenant_id IS
  'Commercial owning agency (reservations.agency_id). Null for global/system facts.';

COMMENT ON COLUMN public.outbox_events.payload IS
  'Minimal event data. Must not include documents, phones, emails, or QR.';

CREATE INDEX IF NOT EXISTS idx_outbox_events_status_available_at
  ON public.outbox_events (status, available_at);

CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate
  ON public.outbox_events (aggregate_type, aggregate_id);

CREATE INDEX IF NOT EXISTS idx_outbox_events_event_type
  ON public.outbox_events (event_type);

CREATE INDEX IF NOT EXISTS idx_outbox_events_created_at
  ON public.outbox_events (created_at DESC);

-- ── 2) Access control (no client exposure) ──────────────────

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.outbox_events FROM PUBLIC;
REVOKE ALL ON TABLE public.outbox_events FROM anon;
REVOKE ALL ON TABLE public.outbox_events FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.outbox_events TO service_role;

-- Explicitly do NOT add to supabase_realtime

-- ── 3) Emit reservation.created.v1 on INSERT ────────────────

CREATE OR REPLACE FUNCTION public.outbox_emit_reservation_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.outbox_events (
    event_type,
    event_version,
    aggregate_type,
    aggregate_id,
    tenant_id,
    payload,
    status,
    attempts,
    available_at
  ) VALUES (
    'reservation.created',
    1,
    'reservation',
    NEW.id,
    NEW.agency_id,
    jsonb_build_object(
      'reservation_id', NEW.id,
      'trip_id', NEW.trip_id,
      'agency_id', NEW.agency_id
    ),
    'pending',
    0,
    NOW()
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.outbox_emit_reservation_created() IS
  'WKR-004: AFTER INSERT on reservations → outbox reservation.created.v1 (same TX).';

DROP TRIGGER IF EXISTS trg_reservations_outbox_created ON public.reservations;

CREATE TRIGGER trg_reservations_outbox_created
  AFTER INSERT ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.outbox_emit_reservation_created();

REVOKE ALL ON FUNCTION public.outbox_emit_reservation_created() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outbox_emit_reservation_created() FROM anon;
REVOKE ALL ON FUNCTION public.outbox_emit_reservation_created() FROM authenticated;
-- Trigger runs as owner (SECURITY DEFINER); no EXECUTE grant needed for clients.
