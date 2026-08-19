-- ============================================================
-- 072_reservation_link_agency_branding.sql
-- F5-004 — Add agency branding colors to public reservation link DTO.
--
-- Adds primary_color, secondary_color, accent_color to the agency
-- object returned by reservation_link_public_body.
-- Preserves all existing behavior and grants from 069.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reservation_link_public_body(p_link_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.reservation_links;
  v_destination TEXT;
  v_departure TIMESTAMPTZ;
  v_agency_name TEXT;
  v_logo TEXT;
  v_primary_color TEXT;
  v_secondary_color TEXT;
  v_accent_color TEXT;
  v_codes TEXT[];
BEGIN
  SELECT * INTO v_link FROM public.reservation_links WHERE id = p_link_id;
  SELECT r.destination, t.departure_time
    INTO v_destination, v_departure
  FROM public.trips t
  JOIN public.routes r ON r.id = t.route_id
  WHERE t.id = v_link.trip_id;

  SELECT a.name INTO v_agency_name FROM public.agencies a WHERE a.id = v_link.agency_id;

  -- Fetch all branding fields in one query
  SELECT s.logo_url, s.primary_color, s.secondary_color, s.accent_color
    INTO v_logo, v_primary_color, v_secondary_color, v_accent_color
  FROM public.agency_settings s WHERE s.agency_id = v_link.agency_id;

  SELECT COALESCE(array_agg(rls.seat_code ORDER BY rls.seat_code), ARRAY[]::TEXT[])
    INTO v_codes
  FROM public.reservation_link_seats rls
  WHERE rls.link_id = p_link_id;

  RETURN jsonb_build_object(
    'trip', jsonb_build_object(
      'destination', v_destination,
      'departure_time', v_departure
    ),
    'agency', jsonb_build_object(
      'name', v_agency_name,
      'logo_url', v_logo,
      'primary_color', v_primary_color,
      'secondary_color', v_secondary_color,
      'accent_color', v_accent_color
    ),
    'seats', to_jsonb(v_codes),
    'link_data', COALESCE(v_link.link_data, '{}'::jsonb),
    'expires_at', v_link.expires_at
  );
END;
$$;

-- Grants remain unchanged (already granted to service_role in 069)