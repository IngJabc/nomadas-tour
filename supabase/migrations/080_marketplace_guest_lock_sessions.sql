-- ============================================================
-- 080_marketplace_guest_lock_sessions.sql
-- Marketplace guest lock ownership: schema and ownership contract only.
--
-- Context:
--   Authenticated marketplace locks keep using seats.locked_by.
--   Guest locks use seats.guest_session_id. A locked seat must have
--   exactly one of those two owners.
--
-- Marketplace migration 7 (080). Requires 074-079 already applied.
-- Additive only: no historical migration is edited and no Tour behavior
-- is removed. Endpoints, frontend, and claim/login arrive in later phases.
--
-- Dry-run:   BEGIN;  \i 080_marketplace_guest_lock_sessions.sql   ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) Guest sessions
-- ============================================================

CREATE TABLE IF NOT EXISTS public.guest_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'claimed', 'expired', 'released')),
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.guest_sessions
  DROP CONSTRAINT IF EXISTS guest_sessions_claim_check;

ALTER TABLE public.guest_sessions
  ADD CONSTRAINT guest_sessions_claim_check
  CHECK (
    ((status IN ('active', 'expired', 'released')) AND customer_id IS NULL)
    OR ((status = 'claimed') AND customer_id IS NOT NULL)
  )
  NOT VALID;

CREATE INDEX IF NOT EXISTS idx_guest_sessions_trip_id
  ON public.guest_sessions (trip_id);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_status_expires_at
  ON public.guest_sessions (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_customer_id
  ON public.guest_sessions (customer_id);

COMMENT ON TABLE public.guest_sessions IS
  'Marketplace guest lock sessions. Stores only the SHA-256 token hash, never the raw guest token.';
COMMENT ON COLUMN public.guest_sessions.token_hash IS
  'SHA-256 hex digest of the opaque guest token held by the browser.';
COMMENT ON COLUMN public.guest_sessions.trip_id IS
  'Trip scope for every seat owned through this session.';
COMMENT ON COLUMN public.guest_sessions.customer_id IS
  'Set only when a guest session is claimed after customer authentication.';
COMMENT ON COLUMN public.guest_sessions.expires_at IS
  'Session authorization deadline. Seat locks still use seats.lock_expires_at.';

-- ============================================================
-- 2) Guest ownership pointer on seats
-- ============================================================

ALTER TABLE public.seats
  ADD COLUMN IF NOT EXISTS guest_session_id UUID
  REFERENCES public.guest_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_seats_guest_session_id
  ON public.seats (guest_session_id);

COMMENT ON COLUMN public.seats.guest_session_id IS
  'Marketplace guest owner for an active seat lock. NULL for authenticated locks and for available seats.';

-- Exactly one logical owner while a seat is locked. NOT VALID preserves
-- compatibility with historical rows; all new and updated rows are checked.
ALTER TABLE public.seats
  DROP CONSTRAINT IF EXISTS seats_single_lock_owner_check;

ALTER TABLE public.seats
  ADD CONSTRAINT seats_single_lock_owner_check
  CHECK (
    status IS DISTINCT FROM 'locked'
    OR (
      (locked_by IS NOT NULL AND guest_session_id IS NULL)
      OR (locked_by IS NULL AND guest_session_id IS NOT NULL)
    )
  )
  NOT VALID;

-- A guest seat must belong to the same trip as its guest session.
CREATE OR REPLACE FUNCTION public.trg_seats_check_guest_session_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_trip UUID;
BEGIN
  IF NEW.status IS DISTINCT FROM 'locked' THEN
    RETURN NEW;
  END IF;

  IF NEW.guest_session_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT trip_id INTO v_session_trip
  FROM public.guest_sessions
  WHERE id = NEW.guest_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_GUEST_SESSION_NOT_FOUND: guest session % does not exist', NEW.guest_session_id;
  END IF;

  IF v_session_trip IS DISTINCT FROM NEW.trip_id THEN
    RAISE EXCEPTION 'ERR_GUEST_SESSION_TRIP_MISMATCH: guest session % does not own trip %', NEW.guest_session_id, NEW.trip_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seats_check_guest_session_trip ON public.seats;
CREATE TRIGGER trg_seats_check_guest_session_trip
  BEFORE INSERT OR UPDATE OF status, guest_session_id, trip_id ON public.seats
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_seats_check_guest_session_trip();

REVOKE EXECUTE ON FUNCTION public.trg_seats_check_guest_session_trip() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_seats_check_guest_session_trip() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_seats_check_guest_session_trip() FROM authenticated;

-- Keep the existing available-seat cleanup compatible with guest locks.
CREATE OR REPLACE FUNCTION public.trg_seats_clear_lock_on_available()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'available' THEN
    NEW.locked_by := NULL;
    NEW.locked_at := NULL;
    NEW.lock_expires_at := NULL;
    NEW.guest_session_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seats_clear_lock_on_available ON public.seats;
CREATE TRIGGER trg_seats_clear_lock_on_available
  BEFORE UPDATE OF status ON public.seats
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_seats_clear_lock_on_available();

REVOKE EXECUTE ON FUNCTION public.trg_seats_clear_lock_on_available() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_seats_clear_lock_on_available() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_seats_clear_lock_on_available() FROM authenticated;

-- ============================================================
-- 3) RLS: guest sessions are backend-controlled
-- ============================================================

REVOKE ALL ON TABLE public.guest_sessions FROM anon, authenticated, PUBLIC;

ALTER TABLE public.guest_sessions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.guest_sessions TO service_role;
