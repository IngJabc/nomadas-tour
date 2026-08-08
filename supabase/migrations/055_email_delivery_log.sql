-- ============================================================
-- 055_email_delivery_log.sql
-- WKR-007 Fase 0 — per-recipient email delivery ledger
--
-- Supports pending → sent + attempts/sent_at for retries.
-- Handlers are NOT implemented in Fase 0.
-- Conceptual event_id → outbox_events.id (no physical FK; retention).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.email_delivery_log (
  event_id UUID NOT NULL,
  recipient_id UUID NOT NULL,
  email_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT email_delivery_log_pkey
    PRIMARY KEY (event_id, recipient_id, email_type),
  CONSTRAINT email_delivery_log_status_check
    CHECK (status IN ('pending', 'sent')),
  CONSTRAINT email_delivery_log_attempts_nonnegative
    CHECK (attempts >= 0)
);

COMMENT ON TABLE public.email_delivery_log IS
  'WKR-007 Fase 0. Idempotency ledger for email fanout (trip emails, reusable by WKR-008). service_role only; not Realtime.';

COMMENT ON COLUMN public.email_delivery_log.event_id IS
  'Outbox event id (conceptual). No FK so outbox retention can purge completed rows.';

COMMENT ON COLUMN public.email_delivery_log.recipient_id IS
  'Agency (or future user) recipient id for this delivery attempt.';

COMMENT ON COLUMN public.email_delivery_log.email_type IS
  'Logical email template / notification type key (e.g. trip_created).';

CREATE INDEX IF NOT EXISTS idx_email_delivery_log_status
  ON public.email_delivery_log (status);

CREATE INDEX IF NOT EXISTS idx_email_delivery_log_created_at
  ON public.email_delivery_log (created_at DESC);

ALTER TABLE public.email_delivery_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_delivery_log FROM PUBLIC;
REVOKE ALL ON TABLE public.email_delivery_log FROM anon;
REVOKE ALL ON TABLE public.email_delivery_log FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_delivery_log TO service_role;

-- Explicitly do NOT add to supabase_realtime
