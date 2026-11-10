-- ============================================================
-- 103_agency_storefront_branding_rollback.sql
-- Rollback de la migracion 103 (Phase 7 — branding del storefront
-- de agencias: cover_url, description, slogan).
-- Ejecutar SOLO si 103 causa problemas en staging/prod.
--
-- Restaura el estado previo:
--   - Elimina las columnas cover_url, description y slogan de
--     public.agency_settings (DROP COLUMN IF EXISTS, idempotente).
--   - Restaura la RPC update_agency_branding version 065 (whitelist
--     de 4 claves: logo_url, primary_color, secondary_color,
--     accent_color) con CREATE OR REPLACE.
--
-- IMPORTANTE — perdida de datos (informativo):
--   El DROP COLUMN ELIMINA la portada, la descripcion y el slogan
--   de TODAS las agencias. Esos valores solo existen para el
--   storefront publico (103): no hay otra fuente. Si se necesitan
--   conservar, exportarlos ANTES del rollback (a mano):
--     SELECT agency_id, cover_url, description, slogan
--       FROM public.agency_settings
--      WHERE cover_url IS NOT NULL OR description IS NOT NULL
--         OR slogan IS NOT NULL;
--   Tras el rollback: el storefront vuelve al banner por defecto y
--   al texto generado; PATCH /agency/settings/branding con esas
--   claves devolvera ERR_BRANDING_KEY; los archivos subidos en el
--   bucket agency-assets quedan huérfanos (eliminarlos a mano si
--   se desea: {agencyId}/cover.*).
--
-- IMPORTANTE — el rollback NO toca:
--   - logo_url, primary_color, secondary_color ni accent_color.
--   - name, subdomain ni ninguna otra columna de agencies.
--   - El bucket agency-assets (042) ni sus archivos.
--   - RLS (041, incluida agency_settings_superadmin_all), policies,
--     GRANT/REVOKE (065) ni otras tablas.
--
-- Dry-run: BEGIN;  \i 103_agency_storefront_branding_rollback.sql  ROLLBACK;
-- ============================================================

ALTER TABLE public.agency_settings DROP COLUMN IF EXISTS cover_url;
ALTER TABLE public.agency_settings DROP COLUMN IF EXISTS description;
ALTER TABLE public.agency_settings DROP COLUMN IF EXISTS slogan;

-- RPC version 065 (whitelist de 4 claves), restaurada tal cual.
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
  v_allowed TEXT[] := ARRAY['logo_url', 'primary_color', 'secondary_color', 'accent_color'];
  v_new_logo TEXT;
  v_new_primary TEXT;
  v_new_secondary TEXT;
  v_new_accent TEXT;
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

  IF v_before = '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'agency_id', p_agency_id,
      'logo_url', v_row.logo_url,
      'primary_color', v_row.primary_color,
      'secondary_color', v_row.secondary_color,
      'accent_color', v_row.accent_color,
      'changed', false
    );
  END IF;

  UPDATE public.agency_settings
  SET logo_url = v_new_logo,
      primary_color = v_new_primary,
      secondary_color = v_new_secondary,
      accent_color = v_new_accent
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
    'changed', true,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.update_agency_branding(UUID, UUID, JSONB, JSONB) IS
  'F5-001: patch agency_settings branding + agency_settings.updated audit. SECURITY DEFINER; EXECUTE service_role only.';
