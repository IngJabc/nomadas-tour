-- ============================================================
-- 100_payment_notification_types.sql
-- PAY-NOTIFICATIONS Task 1 — ampliacion ADITIVA de los CHECK de
-- notifications.type y agency_notification_preferences.category
-- para el flujo de comprobantes de pago (envio, aprobacion y
-- rechazo).
--
-- Por que una migracion nueva y no tocar 029/059/063/069:
--   son historicas y ya aplicadas en el proyecto Supabase
--   compartido: se leen, no se reescriben (politica SEC-009.3-SP1,
--   tests/boarding/migration-immutability.ts). El patron ya usado
--   (069 y sobre todo 086) es guard + DROP/ADD aditivo sobre el
--   CHECK vigente: NADA se quita.
--
-- Que se amplia (solo lo necesario):
--   1. notifications_type_check:
--      + 'payment_receipt_submitted', 'payment_verified',
--        'payment_rejected' (12 valores vigentes de 069 + 3).
--   2. agency_notification_preferences_category_check:
--      + 'payment_notifications' (7 vigentes de 063 + 1).
--   3. update_agency_notification_preferences (065): v_allowed
--      + 'payment_notifications'. Sin esto, el toggle nuevo de la
--      UI de preferencias fallaria con ERR_PREF_CATEGORY.
--   4. Backfill de la preferencia para las agencias existentes
--      (mismo patron que 059/061/063), con el MISMO default que
--      createDefaultPreferences() en el backend: in_app=TRUE,
--      email=TRUE.
--
-- Que NO se toca:
--   - notifications_entity_type_check: las notificaciones de pago
--     usan entity_type='reservation', ya permitido por 069.
--   - recipient_role, RLS, grants, realtime, outbox_events.
--   - Ninguna emision de notificaciones: crear filas con estos
--     tipos es una tarea posterior (PAY-NOTIFICATIONS Task 2+).
--
-- Dry-run:   BEGIN;  \i 100_payment_notification_types.sql   ROLLBACK;
-- Requiere:  063, 065 y 069 aplicados (definen el estado vigente
--            de los CHECK y de la RPC).
-- ============================================================

-- ============================================================
-- 1) notifications_type_check — AMPLIACION ADITIVA
-- ============================================================

-- 1a) Guard: falla con ruido si el CHECK vigente contiene un tipo
--     que 100 no conoce (es decir, si una migracion posterior a
--     069 agrego valores). Evita quitar tipos en silencio.
DO $$
DECLARE
  v_current TEXT;
  v_lit TEXT;
  v_known TEXT[] := ARRAY[
    'trip_created',
    'trip_cancelled',
    'trip_completed',
    'trip_auto_completed',
    'trip_postponed',
    'trip_archived',
    'trip_reminder',
    'reservation_created',
    'reservation_cancelled',
    'passenger_cancelled',
    'occupancy_alert',
    'reservation_link_passenger_data',
    'payment_receipt_submitted',
    'payment_verified',
    'payment_rejected'
  ];
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_current
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass
    AND conname = 'notifications_type_check';

  IF v_current IS NOT NULL THEN
    FOR v_lit IN
      SELECT x[1]
      FROM regexp_matches(v_current, $re$'([^']+)'$re$, 'g') AS r(x)
    LOOP
      IF NOT (v_lit = ANY(v_known)) THEN
        RAISE EXCEPTION 'ERR_100_NOTIFICATION_TYPE_GUARD: notifications_type_check contiene el tipo "%" que 100 no conoce. Una migracion posterior a 069 lo agrego; mergear manualmente antes de aplicar 100.', v_lit;
      END IF;
    END LOOP;
  END IF;
END
$$;

-- 1b) Listado completo: 12 tipos de 069 + 3 nuevos de PAY-NOTIFICATIONS.
--     Orden identico al de 069, los nuevos valores van al final.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'trip_created',
    'trip_cancelled',
    'trip_completed',
    'trip_auto_completed',
    'trip_postponed',
    'trip_archived',
    'trip_reminder',
    'reservation_created',
    'reservation_cancelled',
    'passenger_cancelled',
    'occupancy_alert',
    'reservation_link_passenger_data',
    'payment_receipt_submitted',
    'payment_verified',
    'payment_rejected'
  ));

COMMENT ON CONSTRAINT notifications_type_check ON public.notifications IS
  '029 + 033 + 058 + 059 + 063 + 069 (12 tipos) + 100 payment_receipt_submitted/payment_verified/payment_rejected. Aditivo: no quitar valores.';

-- ============================================================
-- 2) agency_notification_preferences.category — AMPLIACION ADITIVA
-- ============================================================

-- 2a) Guard equivalente para la categoria de preferencias.
DO $$
DECLARE
  v_current TEXT;
  v_lit TEXT;
  v_known TEXT[] := ARRAY[
    'trip_assignments',
    'trip_schedule_changes',
    'trip_status_updates',
    'trip_cancellations',
    'trip_reminders',
    'ops_digest',
    'occupancy_alerts',
    'payment_notifications'
  ];
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_current
  FROM pg_constraint
  WHERE conrelid = 'public.agency_notification_preferences'::regclass
    AND conname = 'agency_notification_preferences_category_check';

  IF v_current IS NOT NULL THEN
    FOR v_lit IN
      SELECT x[1]
      FROM regexp_matches(v_current, $re$'([^']+)'$re$, 'g') AS r(x)
    LOOP
      IF NOT (v_lit = ANY(v_known)) THEN
        RAISE EXCEPTION 'ERR_100_PREF_CATEGORY_GUARD: agency_notification_preferences_category_check contiene la categoria "%" que 100 no conoce. Una migracion posterior a 063 la agrego; mergear manualmente antes de aplicar 100.', v_lit;
      END IF;
    END LOOP;
  END IF;
END
$$;

-- 2b) Listado completo: 7 categorias de 063 + 1 nueva.
ALTER TABLE public.agency_notification_preferences
  DROP CONSTRAINT IF EXISTS agency_notification_preferences_category_check;

ALTER TABLE public.agency_notification_preferences
  ADD CONSTRAINT agency_notification_preferences_category_check
  CHECK (category IN (
    'trip_assignments',
    'trip_schedule_changes',
    'trip_status_updates',
    'trip_cancellations',
    'trip_reminders',
    'ops_digest',
    'occupancy_alerts',
    'payment_notifications'
  ));

COMMENT ON CONSTRAINT agency_notification_preferences_category_check ON public.agency_notification_preferences IS
  '032 + 059 + 061 + 063 (7 categorias) + 100 payment_notifications. Aditivo: no quitar valores.';

-- 2c) Backfill para agencias existentes (patron 059/061/063).
--     Defaults identicos a createDefaultPreferences() del backend.
INSERT INTO public.agency_notification_preferences (
  agency_id, category, in_app_enabled, email_enabled
)
SELECT a.id, 'payment_notifications', TRUE, TRUE
FROM public.agencies a
ON CONFLICT (agency_id, category) DO NOTHING;

-- ============================================================
-- 3) update_agency_notification_preferences — v_allowed + categoria
-- ============================================================

-- CREATE OR REPLACE con la MISMA firma: conserva grants
-- (service_role EXECUTE, REVOKE a PUBLIC/anon/authenticated de
-- 065) y el owner. Unico cambio: v_allowed acepta la categoria
-- nueva, para que el toggle de la UI no falle con ERR_PREF_CATEGORY.
CREATE OR REPLACE FUNCTION public.update_agency_notification_preferences(
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
  v_category TEXT;
  v_enabled BOOLEAN;
  v_allowed TEXT[] := ARRAY[
    'trip_assignments',
    'trip_schedule_changes',
    'trip_status_updates',
    'trip_cancellations',
    'trip_reminders',
    'ops_digest',
    'occupancy_alerts',
    'payment_notifications'
  ];
  v_old_in_app BOOLEAN;
  v_old_email BOOLEAN;
  v_before JSONB := '{}'::jsonb;
  v_after JSONB := '{}'::jsonb;
  v_audit_id UUID;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_agency_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ERR_PREF_PARAMS: agency_id and actor_user_id are required';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'ERR_PREF_PATCH: p_patch must be a JSON object of {category: boolean}';
  END IF;

  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ERR_ACTOR_NOT_FOUND: Actor not found';
  END IF;

  IF v_actor.role <> 'agency' OR v_actor.agency_id IS DISTINCT FROM p_agency_id THEN
    RAISE EXCEPTION 'ERR_ACTOR_AGENCY_MISMATCH: Actor must be agency belonging to p_agency_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agencies WHERE id = p_agency_id) THEN
    RAISE EXCEPTION 'ERR_AGENCY_NOT_FOUND: Agency not found';
  END IF;

  FOR v_category, v_enabled IN
    SELECT
      e.key,
      CASE
        WHEN jsonb_typeof(e.value) = 'boolean' THEN (e.value = 'true'::jsonb)
        ELSE NULL
      END
    FROM jsonb_each(p_patch) AS e
  LOOP
    IF NOT (v_category = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'ERR_PREF_CATEGORY: Unknown notification category: %', v_category;
    END IF;

    IF v_enabled IS NULL THEN
      RAISE EXCEPTION 'ERR_PREF_VALUE: category % must be a boolean', v_category;
    END IF;

    IF v_category = 'trip_cancellations' AND v_enabled IS FALSE THEN
      RAISE EXCEPTION 'ERR_PREF_LOCKED: trip_cancellations cannot be disabled';
    END IF;

    SELECT in_app_enabled, email_enabled
    INTO v_old_in_app, v_old_email
    FROM public.agency_notification_preferences
    WHERE agency_id = p_agency_id
      AND category = v_category
    FOR UPDATE;

    IF NOT FOUND THEN
      v_old_in_app := TRUE;
      v_old_email := TRUE;
    END IF;

    IF v_old_in_app IS DISTINCT FROM v_enabled
       OR v_old_email IS DISTINCT FROM v_enabled THEN
      v_before := v_before || jsonb_build_object(
        v_category,
        jsonb_build_object('in_app', v_old_in_app, 'email', v_old_email)
      );
      v_after := v_after || jsonb_build_object(
        v_category,
        jsonb_build_object('in_app', v_enabled, 'email', v_enabled)
      );

      INSERT INTO public.agency_notification_preferences (
        agency_id, category, in_app_enabled, email_enabled, updated_at
      ) VALUES (
        p_agency_id, v_category, v_enabled, v_enabled, v_now
      )
      ON CONFLICT (agency_id, category) DO UPDATE
      SET in_app_enabled = EXCLUDED.in_app_enabled,
          email_enabled = EXCLUDED.email_enabled,
          updated_at = EXCLUDED.updated_at;
    END IF;
  END LOOP;

  IF v_before <> '{}'::jsonb THEN
    v_audit_id := public.audit_append(
      p_actor_user_id,
      'agency',
      p_agency_id,
      'notification_preferences.updated',
      'notification_preferences',
      p_agency_id,
      v_before,
      v_after,
      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('source', 'api')
    );
  END IF;

  RETURN jsonb_build_object(
    'agency_id', p_agency_id,
    'changed', (v_before <> '{}'::jsonb),
    'before', v_before,
    'after', v_after,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.update_agency_notification_preferences(UUID, UUID, JSONB, JSONB) IS
  'F5-001 + 100: upsert agency notification prefs from boolean patch + single audit row. v_allowed incluye payment_notifications. SECURITY DEFINER; EXECUTE service_role only.';
