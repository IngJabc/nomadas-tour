-- ============================================================
-- 041_agency_settings.sql
-- Agency branding settings (one row per tenant).
--
-- public.agencies remains the source of truth for tenant identity
-- (including the agency name). This table stores only configurable
-- presentation settings so identity and branding remain separated.
-- ============================================================

-- 1) TABLE
CREATE TABLE public.agency_settings (
  -- agency_id is the primary key because settings have a strict 1:1
  -- relationship with public.agencies.
  agency_id UUID PRIMARY KEY
    REFERENCES public.agencies(id)
    ON DELETE CASCADE,
  logo_url TEXT NULL,
  primary_color TEXT NOT NULL DEFAULT '#000024'
    CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color TEXT NOT NULL DEFAULT '#0080FF'
    CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color TEXT NOT NULL DEFAULT '#00D4FF'
    CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.agency_settings IS
  'Configurable branding kept separate from public.agencies, which remains the source of truth for tenant identity.';

COMMENT ON COLUMN public.agency_settings.agency_id IS
  'Primary key and foreign key because each agency has exactly one settings record.';

-- 2) UPDATED_AT
CREATE TRIGGER agency_settings_updated_at
  BEFORE UPDATE ON public.agency_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- 3) ROW LEVEL SECURITY
ALTER TABLE public.agency_settings ENABLE ROW LEVEL SECURITY;

-- Agencies may read only their own branding settings.
CREATE POLICY "agency_settings_agency_select"
  ON public.agency_settings
  FOR SELECT
  USING (
    (SELECT private.auth_app_role()) = 'agency'
    AND agency_id = (SELECT private.auth_app_agency_id())
  );

-- Agencies may update only their own record and cannot move it to
-- another tenant.
CREATE POLICY "agency_settings_agency_update"
  ON public.agency_settings
  FOR UPDATE
  USING (
    (SELECT private.auth_app_role()) = 'agency'
    AND agency_id = (SELECT private.auth_app_agency_id())
  )
  WITH CHECK (
    agency_id = (SELECT private.auth_app_agency_id())
  );

-- Superadmins manage settings for every agency.
CREATE POLICY "agency_settings_superadmin_all"
  ON public.agency_settings
  FOR ALL
  USING (
    (SELECT private.auth_app_role()) = 'superadmin'
  );

-- 4) BACKFILL EXISTING AGENCIES
INSERT INTO public.agency_settings (agency_id)
SELECT id
FROM public.agencies
ON CONFLICT (agency_id) DO NOTHING;

-- 5) REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE public.agency_settings;
