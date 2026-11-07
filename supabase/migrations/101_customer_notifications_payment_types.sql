-- ============================================================
-- 101_customer_notifications_payment_types.sql
-- PAY-NOTIFICATIONS Task 5 — ampliacion ADITIVA del CHECK de
-- customer_notifications.type para los estados de pago del
-- comprobante (aprobacion y rechazo) vistos por el cliente.
--
-- Por que una migracion nueva y no tocar 098:
--   098 es historica y ya aplicada en el proyecto Supabase
--   compartido: se lee, no se reescribe (politica SEC-009.3-SP1,
--   tests/boarding/migration-immutability.ts). El patron ya usado
--   (069, 086, 091 y sobre todo 100) es guard + DROP/ADD aditivo
--   sobre el CHECK vigente: NADA se quita.
--
-- Que se amplia (solo lo necesario):
--   customer_notifications.type:
--     + 'payment_verified', 'payment_rejected'
--       ('review_pending' es el unico valor de 098 y se conserva).
--
-- Que NO se toca:
--   - entity_type ('reservation' | 'review_request'), title, body,
--     action_url, read_at, created_at.
--   - RLS, policies, GRANT/REVOKE, indices ni la estructura de la
--     tabla (solo se reemplaza el CHECK de la columna type).
--   - notifications (029/100) ni agency_notification_preferences.
--   - Ninguna emision de notificaciones (emision = tarea posterior
--     de PAY-NOTIFICATIONS).
--
-- Dry-run:   BEGIN;  \i 101_customer_notifications_payment_types.sql   ROLLBACK;
-- Requiere:  098 aplicado (define el CHECK vigente de type).
-- ============================================================

-- ============================================================
-- 1) customer_notifications.type — AMPLIACION ADITIVA
-- ============================================================

-- 1a) Guard: falla con ruido si el CHECK vigente contiene un tipo
--     que 101 no conoce (es decir, si una migracion posterior a 098
--     agrego valores). Evita quitar tipos en silencio. El guard
--     corre ANTES de sustituir la restriccion.
DO $$
DECLARE
  v_current TEXT;
  v_lit TEXT;
  v_known TEXT[] := ARRAY[
    'review_pending',
    'payment_verified',
    'payment_rejected'
  ];
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO v_current
  FROM pg_constraint
  WHERE conrelid = 'public.customer_notifications'::regclass
    AND conname = 'customer_notifications_type_check';

  IF v_current IS NOT NULL THEN
    FOR v_lit IN
      SELECT x[1]
      FROM regexp_matches(v_current, $re$'([^']+)'$re$, 'g') AS r(x)
    LOOP
      IF NOT (v_lit = ANY(v_known)) THEN
        RAISE EXCEPTION 'ERR_101_CUSTOMER_NOTIFICATION_TYPE_GUARD: customer_notifications_type_check contiene el tipo "%" que 101 no conoce. Una migracion posterior a 098 lo agrego; mergear manualmente antes de aplicar 101.', v_lit;
      END IF;
    END LOOP;
  END IF;
END
$$;

-- 1b) Listado completo: review_pending (098) + 2 tipos de pago de
--     PAY-NOTIFICATIONS. Orden identico al de 098, los nuevos
--     valores van al final. El nombre es el que PostgreSQL genera
--     para el CHECK de columna de 098 (table_column_check).
ALTER TABLE public.customer_notifications
  DROP CONSTRAINT IF EXISTS customer_notifications_type_check;

ALTER TABLE public.customer_notifications
  ADD CONSTRAINT customer_notifications_type_check
  CHECK (type IN (
    'review_pending',
    'payment_verified',
    'payment_rejected'
  ));

COMMENT ON CONSTRAINT customer_notifications_type_check ON public.customer_notifications IS
  '098 (review_pending) + 101 payment_verified/payment_rejected. Aditivo: no quitar valores.';
