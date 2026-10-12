-- ============================================================
-- 086_audit_log_payment_actions.sql
-- MKT-006 Fase 6.1 — ampliacion ADITIVA de los CHECK de audit_log
-- para admitir la auditoria de verificacion/rechazo de pagos.
--
-- Por que una migracion nueva y no tocar 065/069/079:
--   065, 069 y 079 son historicas y ya aplicadas en el proyecto
--   Supabase compartido: se leen, no se reescriben. El patron ya
--   usado por el marketplace (079) es el de guard + DROP/ADD
--   aditivo sobre el CHECK vigente.
--
-- Que se amplia (solo lo necesario):
--   - audit_log_action_check: + 'payment.verified', 'payment.rejected'.
--   - audit_log_entity_type_check: + 'payment'.
--   - audit_log_actor_check: NO se toca (el actor es 'agency',
--     ya permitido por 065/079; el CHECK vigente lo incluye).
--
-- Regla corregida de 079: los CHECK se AMPLIAN de forma aditiva
-- (nada se quita) y se protege con un guard que falla con ruido si
-- una migracion posterior agrego acciones/entidades que 086 no
-- conoce. Antes de sustituir se identifican y conservan TODOS los
-- valores vigentes.
--
-- Migracion marketplace (074-086). Requiere 065, 069 y 079 ya
-- aplicados (definen el estado vigente de los CHECK).
-- Aplicar ANTES de ejecutar las RPCs de 085 (ambas en el mismo
-- release): 085 inserta auditoria con estas acciones/entidad.
-- NO se toca: 065, 069, 079, actor_check, RPCs, tablas.
--
-- Dry-run:   BEGIN;  \i 086_audit_log_payment_actions.sql   ROLLBACK;
-- ============================================================

-- ============================================================
-- 1) audit_log_action_check — AMPLIACION ADITIVA
-- ============================================================

-- 1a) Guard: falla con mensaje claro si el CHECK vigente contiene una
--     accion que 086 no conoce (es decir, si una migracion posterior a
--     079 agrego valores). Evita silenciosamente quitar acciones.
DO $$
DECLARE
  v_current TEXT;
  v_lit TEXT;
  v_known TEXT[] := ARRAY[
    'trip.created',
    'trip.updated',
    'trip.cancelled',
    'reservation.created',
    'reservation.cancelled',
    'boarding.board',
    'boarding.unboard',
    'agency_settings.updated',
    'notification_preferences.updated',
    'reservation_link.created',
    'reservation_link.cancelled',
    'reservation_link.confirmed',
    'reservation_link.regenerated',
    'reservation_link.passenger_data_saved',
    'reservation_link.expired',
    'reservation.passenger_cancelled',
    'payment.verified',
    'payment.rejected'
  ];
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_current
  FROM pg_constraint
  WHERE conrelid = 'public.audit_log'::regclass
    AND conname = 'audit_log_action_check';

  IF v_current IS NOT NULL THEN
    FOR v_lit IN
      SELECT x[1]
      FROM regexp_matches(v_current, $re$'([^']+)'$re$, 'g') AS r(x)
    LOOP
      IF NOT (v_lit = ANY(v_known)) THEN
        RAISE EXCEPTION 'ERR_086_ACTION_GUARD: audit_log_action_check contiene la accion "%" que 086 no conoce. Una migracion posterior a 079 la agrego; mergear manualmente antes de aplicar 086.', v_lit;
      END IF;
    END LOOP;
  END IF;
END
$$;

-- 1b) Listado completo: 16 acciones de 079 + 2 nuevas de MKT-006.
--     Orden identico al de 079, los nuevos valores van al final.
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_action_check CHECK (
    action IN (
      'trip.created',
      'trip.updated',
      'trip.cancelled',
      'reservation.created',
      'reservation.cancelled',
      'boarding.board',
      'boarding.unboard',
      'agency_settings.updated',
      'notification_preferences.updated',
      'reservation_link.created',
      'reservation_link.cancelled',
      'reservation_link.confirmed',
      'reservation_link.regenerated',
      'reservation_link.passenger_data_saved',
      'reservation_link.expired',
      'reservation.passenger_cancelled',
      'payment.verified',
      'payment.rejected'
    )
  );

COMMENT ON CONSTRAINT audit_log_action_check ON public.audit_log IS
  '065 + 069 + 079 (16 acciones) + 086 payment.verified/payment.rejected. Aditivo: no quitar valores.';

-- ============================================================
-- 2) audit_log_entity_type_check — AMPLIACION ADITIVA
-- ============================================================

-- 2a) Guard equivalente para entity_type: preserva los 6 valores de
--     069 y solo admite ampliar el conjunto.
DO $$
DECLARE
  v_current TEXT;
  v_lit TEXT;
  v_known TEXT[] := ARRAY[
    'trip',
    'reservation',
    'reservation_passenger',
    'agency_settings',
    'notification_preferences',
    'reservation_link',
    'payment'
  ];
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_current
  FROM pg_constraint
  WHERE conrelid = 'public.audit_log'::regclass
    AND conname = 'audit_log_entity_type_check';

  IF v_current IS NOT NULL THEN
    FOR v_lit IN
      SELECT x[1]
      FROM regexp_matches(v_current, $re$'([^']+)'$re$, 'g') AS r(x)
    LOOP
      IF NOT (v_lit = ANY(v_known)) THEN
        RAISE EXCEPTION 'ERR_086_ENTITY_GUARD: audit_log_entity_type_check contiene el valor "%" que 086 no conoce. Una migracion posterior a 069 lo agrego; mergear manualmente antes de aplicar 086.', v_lit;
      END IF;
    END LOOP;
  END IF;
END
$$;

-- 2b) Listado completo: 6 entidades de 069 + 1 nueva de MKT-006.
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_type_check CHECK (
    entity_type IN (
      'trip',
      'reservation',
      'reservation_passenger',
      'agency_settings',
      'notification_preferences',
      'reservation_link',
      'payment'
    )
  );

COMMENT ON CONSTRAINT audit_log_entity_type_check ON public.audit_log IS
  '065 + 069 (6 entidades) + 086 payment. Aditivo: no quitar valores.';

-- ============================================================
-- 3) NOTA sobre audit_log_actor_check: NO se toca. 065/079 ya
--    permiten 'agency', que es el actor que usan las RPCs de 085
--    (Fase 6.2B: revision de pagos por agencia).
-- ============================================================
