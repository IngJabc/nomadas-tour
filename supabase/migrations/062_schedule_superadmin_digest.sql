-- ============================================================
-- 062_schedule_superadmin_digest.sql
-- F4-002 — Superadmin Daily Digest: preferencias + emit_platform_event
--
-- UUID determinístico del aggregate_id: R1 = UUIDv5 / SHA-1 via
-- node:crypto en TypeScript (backend/src/utils/deterministic-uuid.ts).
-- Esta migración NO duplica esa lógica, NO usa MD5 y NO instala
-- extensiones de PostgreSQL.
-- ============================================================

-- ── 1) superadmin_notification_preferences ────────────────────
CREATE TABLE IF NOT EXISTS public.superadmin_notification_preferences (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('superadmin_digest')),
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, category)
);

COMMENT ON TABLE public.superadmin_notification_preferences IS
  'F4-002: per-superadmin notification prefs. Category v1 = superadmin_digest. Email default ON (opt-out); in-app default OFF.';

-- Backfill existing superadmins (idempotent). No table CHECK on users.role.
INSERT INTO public.superadmin_notification_preferences (
  user_id, category, email_enabled, in_app_enabled
)
SELECT u.id, 'superadmin_digest', TRUE, FALSE
FROM public.users u
WHERE u.role = 'superadmin'
ON CONFLICT (user_id, category) DO NOTHING;

ALTER TABLE public.superadmin_notification_preferences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.superadmin_notification_preferences FROM PUBLIC;
REVOKE ALL ON TABLE public.superadmin_notification_preferences FROM anon;
REVOKE ALL ON TABLE public.superadmin_notification_preferences FROM authenticated;

-- Authenticated SELECT so the superadmin policy can apply (032-style).
GRANT SELECT ON TABLE public.superadmin_notification_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.superadmin_notification_preferences TO service_role;

DROP POLICY IF EXISTS "superadmin_digest_prefs_select"
  ON public.superadmin_notification_preferences;

CREATE POLICY "superadmin_digest_prefs_select"
  ON public.superadmin_notification_preferences
  FOR SELECT
  USING ((SELECT private.auth_app_role()) = 'superadmin');

-- ── 2) emit_platform_event — generic platform outbox writer ───
-- Abstraction for platform.* facts (aggregate_type / tenant_id
-- caller-supplied). Distinct from the agency-scoped emitter (which
-- hardcodes aggregate_type='agency' and tenant_id=agency_id).
CREATE OR REPLACE FUNCTION public.emit_platform_event(
  p_event_type TEXT,
  p_aggregate_type TEXT,
  p_aggregate_id UUID,
  p_tenant_id UUID,
  p_payload JSONB,
  p_dedup_key TEXT,
  p_available_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted BOOLEAN := FALSE;
BEGIN
  INSERT INTO public.outbox_events (
    event_type,
    event_version,
    aggregate_type,
    aggregate_id,
    tenant_id,
    payload,
    status,
    attempts,
    available_at,
    dedup_key
  ) VALUES (
    p_event_type,
    1,
    p_aggregate_type,
    p_aggregate_id,
    p_tenant_id,
    p_payload,
    'pending',
    0,
    COALESCE(p_available_at, NOW()),
    p_dedup_key
  )
  ON CONFLICT DO NOTHING
  RETURNING TRUE INTO v_inserted;

  RETURN COALESCE(v_inserted, FALSE);
END;
$$;

COMMENT ON FUNCTION public.emit_platform_event(TEXT, TEXT, UUID, UUID, JSONB, TEXT, TIMESTAMPTZ) IS
  'F4-002: generic platform outbox writer (caller supplies aggregate_type/tenant_id). ON CONFLICT DO NOTHING. SECURITY DEFINER; EXECUTE service_role only.';

REVOKE EXECUTE ON FUNCTION public.emit_platform_event(TEXT, TEXT, UUID, UUID, JSONB, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.emit_platform_event(TEXT, TEXT, UUID, UUID, JSONB, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE EXECUTE ON FUNCTION public.emit_platform_event(TEXT, TEXT, UUID, UUID, JSONB, TEXT, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.emit_platform_event(TEXT, TEXT, UUID, UUID, JSONB, TEXT, TIMESTAMPTZ) TO service_role;
