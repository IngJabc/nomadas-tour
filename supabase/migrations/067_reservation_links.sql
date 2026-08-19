-- ============================================================
-- 067_reservation_links.sql
-- F5-004 — Reservation link tables, is_active sync, RLS deny-all
--
-- trip_id ON DELETE RESTRICT (historical rows are not cascaded).
-- seat_id ON DELETE SET NULL + denormalized seat_code.
-- Access: service_role only (040 pattern). Not in supabase_realtime.
-- ============================================================

CREATE TABLE public.reservation_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    TEXT NOT NULL UNIQUE,
  trip_id       UUID NOT NULL REFERENCES public.trips(id) ON DELETE RESTRICT,
  agency_id     UUID NOT NULL REFERENCES public.agencies(id),
  created_by    UUID NOT NULL REFERENCES auth.users(id),
  status        TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'confirmed', 'cancelled')),
  expires_at    TIMESTAMPTZ NOT NULL,
  link_data     JSONB NOT NULL DEFAULT '{}'::jsonb,
  trip_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rl_trip_id ON public.reservation_links(trip_id);
CREATE INDEX idx_rl_agency_id ON public.reservation_links(agency_id);
CREATE INDEX idx_rl_status ON public.reservation_links(status);

COMMENT ON TABLE public.reservation_links IS
  'F5-004: shareable draft-link for passenger data entry. Not a reservation.';

CREATE TABLE public.reservation_link_seats (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id    UUID NOT NULL REFERENCES public.reservation_links(id) ON DELETE CASCADE,
  seat_id    UUID REFERENCES public.seats(id) ON DELETE SET NULL,
  seat_code  TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (link_id, seat_code)
);

CREATE INDEX idx_rls_link_id ON public.reservation_link_seats(link_id);
CREATE INDEX idx_rls_seat_id ON public.reservation_link_seats(seat_id);

CREATE UNIQUE INDEX idx_reservation_link_seats_active_seat
  ON public.reservation_link_seats (seat_id)
  WHERE is_active = TRUE;

COMMENT ON COLUMN public.reservation_link_seats.is_active IS
  'Denormalized: TRUE iff parent reservation_links.status = active. Partial unique index.';

-- ── is_active sync triggers ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_sync_seat_link_active()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.reservation_link_seats rls
  SET is_active = (
    SELECT rl.status = 'active'
    FROM public.reservation_links rl
    WHERE rl.id = rls.link_id
  )
  WHERE rls.id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_active_on_seat_link ON public.reservation_link_seats;
CREATE TRIGGER trg_sync_active_on_seat_link
  AFTER INSERT OR UPDATE OF link_id
  ON public.reservation_link_seats
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_seat_link_active();

CREATE OR REPLACE FUNCTION public.trg_sync_link_status_to_seats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.reservation_link_seats rls
    SET is_active = (NEW.status = 'active')
    WHERE rls.link_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_link_status ON public.reservation_links;
CREATE TRIGGER trg_sync_link_status
  AFTER UPDATE OF status
  ON public.reservation_links
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_link_status_to_seats();

DROP TRIGGER IF EXISTS reservation_links_updated_t ON public.reservation_links;
CREATE TRIGGER reservation_links_updated_t
  BEFORE UPDATE ON public.reservation_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ── RLS + grants (040 pattern) ──────────────────────────────

REVOKE ALL ON TABLE public.reservation_links FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.reservation_link_seats FROM anon, authenticated, PUBLIC;

ALTER TABLE public.reservation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_link_seats ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reservation_links TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reservation_link_seats TO service_role;

REVOKE EXECUTE ON FUNCTION public.trg_sync_seat_link_active() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_sync_seat_link_active() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_sync_seat_link_active() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.trg_sync_link_status_to_seats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_sync_link_status_to_seats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_sync_link_status_to_seats() FROM authenticated;
