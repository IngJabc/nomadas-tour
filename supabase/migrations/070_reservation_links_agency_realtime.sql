-- ============================================================
-- 070_reservation_links_agency_realtime.sql
-- F5-004 UI — agency SELECT + Realtime on own reservation_links.
--
-- Public passenger page still has no realtime (design invariant 11).
-- Authenticated agencies may SELECT only their tenant rows so the
-- wizard can subscribe to link_data while the passenger saves.
-- Writes stay service_role / RPCs. token_hash is never needed in
-- the client select list (wizard uses id, link_data, status).
-- ============================================================

GRANT SELECT ON TABLE public.reservation_links TO authenticated;

DROP POLICY IF EXISTS reservation_links_agency_select ON public.reservation_links;
CREATE POLICY reservation_links_agency_select
  ON public.reservation_links
  FOR SELECT
  USING (
    (SELECT private.auth_app_role()) = 'agency'
    AND agency_id = (SELECT private.auth_app_agency_id())
  );

COMMENT ON POLICY reservation_links_agency_select ON public.reservation_links IS
  'F5-004: agency may read own draft links for wizard realtime. No public/anon SELECT.';

ALTER TABLE public.reservation_links REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.reservation_links;
