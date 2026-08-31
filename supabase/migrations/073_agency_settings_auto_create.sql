-- ============================================================
-- 073_agency_settings_auto_create.sql
-- Ensures every agency has a corresponding agency_settings row.
--
-- Migration 041 backfilled existing agencies at creation time,
-- but lacked a trigger for new agencies created afterwards.
-- This migration adds that trigger and backfills any missing rows.
-- ============================================================

-- 1) BACKFILL — agencies missing agency_settings get a default row
INSERT INTO public.agency_settings (agency_id)
SELECT a.id
FROM public.agencies a
LEFT JOIN public.agency_settings s ON s.agency_id = a.id
WHERE s.agency_id IS NULL
ON CONFLICT (agency_id) DO NOTHING;

-- 2) TRIGGER FUNCTION — auto-create agency_settings on agency insert
CREATE OR REPLACE FUNCTION public.create_agency_settings_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.agency_settings (agency_id)
  VALUES (NEW.id)
  ON CONFLICT (agency_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3) TRIGGER — fires after a new agency is created
DROP TRIGGER IF EXISTS agency_settings_on_insert ON public.agencies;
CREATE TRIGGER agency_settings_on_insert
  AFTER INSERT ON public.agencies
  FOR EACH ROW
  EXECUTE FUNCTION public.create_agency_settings_on_insert();
