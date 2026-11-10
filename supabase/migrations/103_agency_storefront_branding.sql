-- ============================================================
-- 103_agency_storefront_branding.sql
-- Phase 7 — Agency Storefront Branding and Customization
--
-- Additive extension of public.agency_settings (041) with the three
-- commercial presentation fields the public storefront can show:
--   * cover_url    — cover/banner image (uploaded to the EXISTING
--                    `agency-assets` bucket, agency-scoped path)
--   * description  — commercial description of the agency
--   * slogan       — optional highlighted phrase
--
-- Identity (name, subdomain) stays in public.agencies (041 contract).
-- Colors/logo stay untouched. No new tables, no new buckets.
--
-- Extends the update_agency_branding RPC (065) whitelist so the agency
-- can patch the new keys through the SAME audited, ownership-checked
-- path. Actor rules are unchanged: the RPC still requires an agency
-- actor belonging to p_agency_id (service_role execute only, 065).
--
-- SUPERADMIN: unchanged. RLS "agency_settings_superadmin_all" (041)
-- is table-level, so it already covers the new columns.
--
-- NOT APPLIED by this repository's workflows — apply manually per
-- environment when deploying.
-- ============================================================

-- 1) COLUMNS (additive; existing rows keep NULL = "sin personalizar")
ALTER TABLE public.agency_settings
  ADD COLUMN IF NOT EXISTS cover_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS description TEXT NULL,
  ADD COLUMN IF NOT EXISTS slogan TEXT NULL;

-- Límites de presentación (texto comercial corto, no un CMS libre).
ALTER TABLE public.agency_settings
  DROP CONSTRAINT IF EXISTS agency_settings_slogan_length;
ALTER TABLE public.agency_settings
  ADD CONSTRAINT agency_settings_slogan_length
  CHECK (slogan IS NULL OR char_length(slogan) <= 160);

ALTER TABLE public.agency_settings
  DROP CONSTRAINT IF EXISTS agency_settings_description_length;
ALTER TABLE public.agency_settings
  ADD CONSTRAINT agency_settings_description_length
  CHECK (description IS NULL OR char_length(description) <= 2000);

COMMENT ON COLUMN public.agency_settings.cover_url IS
  'Phase 7: public storefront cover/banner image URL (existing agency-assets bucket, {agencyId}/cover.{ext}). NULL = banner por defecto.';
COMMENT ON COLUMN public.agency_settings.description IS
  'Phase 7: commercial description shown in the public storefront "Sobre la agencia". NULL = texto generado por la plataforma.';
COMMENT ON COLUMN public.agency_settings.slogan IS
  'Phase 7: optional highlighted phrase shown under the agency name. NULL = sin slogan.';

-- 2) RPC update_agency_branding (065) — misma función, whitelist extendido.
--    CREATE OR REPLACE conserva owner/privileges (065 los fija aparte).
CREATE OR REPLACE FUNCTION public.update_agency_branding(
  p_agency_id UUID,
  p_actor_user_id UUID,
  p_patch JSONB,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_row public.agency_settings%ROWTYPE;
  v_before JSONB := '{}'::jsonb;
  v_after JSONB := '{}'::jsonb;
  v_key TEXT;
  v_allowed TEXT[] := ARRAY[
    'logo_url', 'primary_color', 'secondary_color', 'accent_color',
    'cover_url', 'description', 'slogan'
  ];
  v_new_logo TEXT;
  v_new_primary TEXT;
  v_new_secondary TEXT;
  v_new_accent TEXT;
  v_new_cover TEXT;
  v_new_description TEXT;
  v_new_slogan TEXT;
  v_audit_id UUID;
BEGIN
  IF p_agency_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_BRANDING_PARAMS: agency_id and actor_user_id are required';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'ERR_BRANDING_PATCH: p_patch must be a JSON object';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch)
  LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'ERR_BRANDING_KEY: unknown branding key %', v_key;
    END IF;
  END LOOP;

  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ACTOR_NOT_FOUND: Actor not found';
  END IF;

  IF v_actor.role <> 'agency' OR v_actor.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_ACTOR_AGENCY_MISMATCH: Actor must be agency belonging to p_agency_id';
  END IF;

  SELECT * INTO v_row
  FROM public.agency_settings
  WHERE agency_id = p_agency_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_SETTINGS_NOT_FOUND: Configuración de marca no encontrada';
  END IF;

  v_new_logo := v_row.logo_url;
  v_new_primary := v_row.primary_color;
  v_new_secondary := v_row.secondary_color;
  v_new_accent := v_row.accent_color;
  v_new_cover := v_row.cover_url;
  v_new_description := v_row.description;
  v_new_slogan := v_row.slogan;

  IF p_patch ? 'logo_url' THEN
    IF jsonb_typeof(p_patch->'logo_url') = 'null' THEN
      v_new_logo := NULL;
    ELSE
      v_new_logo := p_patch->>'logo_url';
    END IF;
  END IF;
  IF p_patch ? 'primary_color' THEN
    v_new_primary := p_patch->>'primary_color';
  END IF;
  IF p_patch ? 'secondary_color' THEN
    v_new_secondary := p_patch->>'secondary_color';
  END IF;
  IF p_patch ? 'accent_color' THEN
    v_new_accent := p_patch->>'accent_color';
  END IF;
  IF p_patch ? 'cover_url' THEN
    IF jsonb_typeof(p_patch->'cover_url') = 'null' THEN
      v_new_cover := NULL;
    ELSE
      v_new_cover := p_patch->>'cover_url';
    END IF;
  END IF;
  IF p_patch ? 'description' THEN
    IF jsonb_typeof(p_patch->'description') = 'null' THEN
      v_new_description := NULL;
    ELSE
      v_new_description := p_patch->>'description';
    END IF;
  END IF;
  IF p_patch ? 'slogan' THEN
    IF jsonb_typeof(p_patch->'slogan') = 'null' THEN
      v_new_slogan := NULL;
    ELSE
      v_new_slogan := p_patch->>'slogan';
    END IF;
  END IF;

  IF v_row.logo_url IS DISTINCT FROM v_new_logo THEN
    v_before := v_before || jsonb_build_object('logo_url', v_row.logo_url);
    v_after := v_after || jsonb_build_object('logo_url', v_new_logo);
  END IF;
  IF v_row.primary_color IS DISTINCT FROM v_new_primary THEN
    v_before := v_before || jsonb_build_object('primary_color', v_row.primary_color);
    v_after := v_after || jsonb_build_object('primary_color', v_new_primary);
  END IF;
  IF v_row.secondary_color IS DISTINCT FROM v_new_secondary THEN
    v_before := v_before || jsonb_build_object('secondary_color', v_row.secondary_color);
    v_after := v_after || jsonb_build_object('secondary_color', v_new_secondary);
  END IF;
  IF v_row.accent_color IS DISTINCT FROM v_new_accent THEN
    v_before := v_before || jsonb_build_object('accent_color', v_row.accent_color);
    v_after := v_after || jsonb_build_object('accent_color', v_new_accent);
  END IF;
  IF v_row.cover_url IS DISTINCT FROM v_new_cover THEN
    v_before := v_before || jsonb_build_object('cover_url', v_row.cover_url);
    v_after := v_after || jsonb_build_object('cover_url', v_new_cover);
  END IF;
  IF v_row.description IS DISTINCT FROM v_new_description THEN
    v_before := v_before || jsonb_build_object('description', v_row.description);
    v_after := v_after || jsonb_build_object('description', v_new_description);
  END IF;
  IF v_row.slogan IS DISTINCT FROM v_new_slogan THEN
    v_before := v_before || jsonb_build_object('slogan', v_row.slogan);
    v_after := v_after || jsonb_build_object('slogan', v_new_slogan);
  END IF;

  IF v_before = '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'agency_id', p_agency_id,
      'logo_url', v_row.logo_url,
      'primary_color', v_row.primary_color,
      'secondary_color', v_row.secondary_color,
      'accent_color', v_row.accent_color,
      'cover_url', v_row.cover_url,
      'description', v_row.description,
      'slogan', v_row.slogan,
      'changed', false
    );
  END IF;

  UPDATE public.agency_settings
  SET logo_url = v_new_logo,
      primary_color = v_new_primary,
      secondary_color = v_new_secondary,
      accent_color = v_new_accent,
      cover_url = v_new_cover,
      description = v_new_description,
      slogan = v_new_slogan
  WHERE agency_id = p_agency_id
  RETURNING * INTO v_row;

  v_audit_id := public.audit_append(
    p_actor_user_id,
    'agency',
    p_agency_id,
    'agency_settings.updated',
    'agency_settings',
    p_agency_id,
    v_before,
    v_after,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source', 'api')
  );

  RETURN jsonb_build_object(
    'agency_id', p_agency_id,
    'logo_url', v_row.logo_url,
    'primary_color', v_row.primary_color,
    'secondary_color', v_row.secondary_color,
    'accent_color', v_row.accent_color,
    'cover_url', v_row.cover_url,
    'description', v_row.description,
    'slogan', v_row.slogan,
    'changed', true,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.update_agency_branding(UUID, UUID, JSONB, JSONB) IS
  'Phase 7 (was F5-001): patch agency_settings branding incl. storefront fields (cover_url, description, slogan) + agency_settings.updated audit. SECURITY DEFINER; EXECUTE service_role only.';

-- Los privilegios de ejecución NO cambian: 065 ya revoca PUBLIC/anon/
-- authenticated y otorga solo a service_role. CREATE OR REPLACE conserva
-- la ACL existente de la función.
