-- ============================================================
-- 071_invalidate_reservation_link.sql
-- F5-004 — Cancel link without releasing seat locks.
--
-- Used when agency changes seat selection: link must die but locks
-- follow normal lifecycle (same as regenerate old link, link expiry).
-- Explicit "Cancelar enlace" keeps using cancel_reservation_link.
-- ============================================================

CREATE OR REPLACE FUNCTION public.invalidate_reservation_link(
  p_link_id UUID,
  p_agency_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.reservation_links;
  v_actor UUID;
BEGIN
  SELECT * INTO v_link
  FROM public.reservation_links
  WHERE id = p_link_id
  FOR UPDATE;

  IF NOT FOUND OR v_link.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_LINK_NOT_FOUND: Link not found';
  END IF;

  IF v_link.status IN ('expired', 'cancelled', 'confirmed') THEN
    RAISE EXCEPTION 'ERR_LINK_NOT_FOUND: Link not found';
  END IF;

  UPDATE public.reservation_links SET status = 'cancelled' WHERE id = p_link_id;

  PERFORM public.emit_reservation_link_event(
    'reservation_link.cancelled',
    p_link_id,
    p_agency_id,
    jsonb_build_object('link_id', p_link_id, 'trip_id', v_link.trip_id, 'agency_id', p_agency_id),
    'reservation_link.cancelled:' || p_link_id::text
  );

  v_actor := v_link.created_by;
  PERFORM public.audit_append(
    v_actor, 'agency', p_agency_id,
    'reservation_link.cancelled', 'reservation_link', p_link_id,
    NULL, jsonb_build_object('status', 'cancelled', 'release_seats', false),
    '{}'::jsonb
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.invalidate_reservation_link(UUID, UUID) IS
  'F5-004: mark link cancelled without releasing locks (seat selection change).';

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'invalidate_reservation_link'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
