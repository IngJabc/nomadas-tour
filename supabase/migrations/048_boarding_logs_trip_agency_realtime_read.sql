-- ============================================================
-- 048_boarding_logs_trip_agency_realtime_read.sql
-- AUD-020.12 — Realtime boarding visibility for trip-assigned agencies
--
-- Problem:
--   Realtime delivers boarding_logs only when SELECT RLS allows the row.
--   bl_agency_read was ownership-only (reservations.agency_id), so a
--   non-owner agency assigned to the same trip never received events.
--
-- Fix:
--   Allow SELECT on boarding_logs when the operator agency is assigned
--   to boarding_logs.trip_id via trip_agencies (operational rule / ADR-001).
--   Keep commercial-owner path. Do not widen reservation_passengers SELECT
--   (PII). Identity via private.auth_app_* (public.users), not JWT claims.
--
-- Does NOT modify: boarding_toggle, reservations RLS, ADR-001 model.
-- ============================================================

DROP POLICY IF EXISTS "bl_agency_read" ON public.boarding_logs;

CREATE POLICY "bl_agency_read" ON public.boarding_logs
  FOR SELECT
  USING (
    (SELECT private.auth_app_role()) = 'agency'
    AND (
      -- Commercial owner of the reservation
      reservation_id IN (
        SELECT r.id
        FROM public.reservations AS r
        WHERE r.agency_id = (SELECT private.auth_app_agency_id())
      )
      OR
      -- Operational: agency assigned to the trip of this boarding event
      (
        trip_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.trip_agencies AS ta
          WHERE ta.trip_id = boarding_logs.trip_id
            AND ta.agency_id = (SELECT private.auth_app_agency_id())
        )
      )
    )
  );

COMMENT ON POLICY "bl_agency_read" ON public.boarding_logs IS
  'AUD-020.12: agency may read boarding_logs for owned reservations OR trips in trip_agencies. Enables cross-agency Realtime without exposing reservation_passengers PII.';
