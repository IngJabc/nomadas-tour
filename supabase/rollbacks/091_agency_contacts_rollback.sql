-- ============================================================
-- 091_agency_contacts_rollback.sql
-- MKT-008 Fase 1 - Rollback manual de 091_agency_contacts.sql.
--
-- Elimina EXCLUSIVAMENTE los objetos creados por 091:
--   - Funciones: create_agency_contact, update_agency_contact,
--     delete_agency_contact, agency_contact_normalize_phone.
--   - Trigger: agency_contacts_updated_t.
--   - Tabla: public.agency_contacts (y sus indices).
--   - CHECKs de audit_log: restaura las listas de 089 (sin
--     agency_contact.created/updated/deleted ni la entidad
--     agency_contact).
--
-- NO toca ninguna otra tabla, RPC, policy, columna ni dato de
-- otras funcionalidades (reservas, asientos, checkout_attempts,
-- pagos, canales de pago, branding, notificaciones).
--
-- IMPORTANTE - limitaciones y precondiciones del rollback:
--   1) Al eliminar la tabla se pierden TODOS los contactos,
--      incluidos los que estaban en borrado logico (deleted_at).
--      Un rollback de esquema NO garantiza restaurar contactos que
--      ya se hayan eliminado logicamente: sus filas se eliminan con
--      la tabla.
--   2) El rollback de los CHECK de audit_log vuelve a las listas
--      de 089. Si una migracion posterior a 091 agrego mas
--      acciones o entidades, el guard ERR_091_ROLLBACK_* aborta y
--      habra que mergear manualmente.
--   3) PRECONDICION OBLIGATORIA - el rollback integral de los CHECK
--      de audit_log requiere CERO eventos con action
--      'agency_contact.created|updated|deleted' y CERO eventos con
--      entity_type 'agency_contact'. audit_log es append-only
--      (065): esos eventos no se pueden borrar ni modificar. Si
--      existen, este script ABORTA AL INICIO (antes de cualquier
--      DROP) con ERR_091_ROLLBACK_AUDIT_EVENTS. No se borran
--      eventos, no se desactiva el trigger append-only y no se
--      eluden los CHECKs. Decide la politica de retencion de esos
--      eventos (por ejemplo: conservarlos y reintroducir sus
--      valores en el CHECK al re-aplicar 091 o una 092) y solo
--      despues vuelve a ejecutar este rollback. Los datos
--      historicos de auditoria se conservan; su retencion no se
--      resuelve eliminandolos durante el rollback.
--   4) agencies.phone (legado, fallback publico) NO se toco en 091
--      ni se toca aqui.
--
-- NO revierte datos de otras tablas.
--
-- Dry-run: BEGIN; \i 091_agency_contacts_rollback.sql ROLLBACK;
-- ============================================================

-- ============================================================
-- 0) PRECONDICION - audit_log append-only (065).
--    El rollback integral de los CHECK restaura las listas de 089
--    (sin agency_contact). Ese CHECK valida TODAS las filas
--    existentes de audit_log; los eventos agency_contact.* ya
--    escritos lo violarian y no se pueden borrar (append-only).
--    Se comprueba ANTES de cualquier DROP para abortar de forma
--    segura sin dejar la base a medio revertir.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.audit_log
    WHERE action IN (
            'agency_contact.created',
            'agency_contact.updated',
            'agency_contact.deleted'
          )
       OR entity_type = 'agency_contact'
  ) THEN
    RAISE EXCEPTION 'ERR_091_ROLLBACK_AUDIT_EVENTS: audit_log contiene eventos de contactos (action agency_contact.* o entity_type agency_contact). El rollback integral de los CHECK de audit_log no puede completarse mientras esos eventos existan porque audit_log es append-only (065). Decide la politica de retencion de los eventos de contactos (no los borres aqui) y vuelve a ejecutar el rollback; si conservas los eventos, reintroduce sus valores en el CHECK al re-aplicar 091 o una 092.';
  END IF;
END
$$;

-- 1) Funciones.
DROP FUNCTION IF EXISTS public.create_agency_contact(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER);
DROP FUNCTION IF EXISTS public.update_agency_contact(UUID, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS public.delete_agency_contact(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.agency_contact_normalize_phone(TEXT);

-- 2) Trigger y tabla (y sus indices).
DROP TRIGGER IF EXISTS agency_contacts_updated_t ON public.agency_contacts;
DROP TABLE IF EXISTS public.agency_contacts;

-- 3) audit_log: restaura las listas de 089 (sin agency_contact).
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
    'payment.rejected',
    'checkout.verified',
    'checkout.rejected',
    'checkout.expired',
    'checkout.cancelled',
    'agency_payment_method.created',
    'agency_payment_method.updated',
    'agency_payment_method.primary_set',
    'agency_payment_method.deleted',
    'agency_contact.created',
    'agency_contact.updated',
    'agency_contact.deleted'
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
        RAISE EXCEPTION 'ERR_091_ROLLBACK_ACTION: audit_log_action_check contiene la accion "%" que el rollback de 091 no restaura. Mergear manualmente antes de aplicar el rollback.', v_lit;
      END IF;
    END LOOP;
  END IF;
END
$$;

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
      'payment.rejected',
      'checkout.verified',
      'checkout.rejected',
      'checkout.expired',
      'checkout.cancelled',
      'agency_payment_method.created',
      'agency_payment_method.updated',
      'agency_payment_method.primary_set',
      'agency_payment_method.deleted'
    )
  );

COMMENT ON CONSTRAINT audit_log_action_check ON public.audit_log IS
  'Restaurado por 091_rollback a la lista de 089 (26 acciones). Re-aplicar 091 (o migracion posterior) reintroduce agency_contact.*.';

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
    'payment',
    'checkout_attempt',
    'agency_payment_method',
    'agency_contact'
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
        RAISE EXCEPTION 'ERR_091_ROLLBACK_ENTITY: audit_log_entity_type_check contiene el valor "%" que el rollback de 091 no restaura. Mergear manualmente antes de aplicar el rollback.', v_lit;
      END IF;
    END LOOP;
  END IF;
END
$$;

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
      'payment',
      'checkout_attempt',
      'agency_payment_method'
    )
  );

COMMENT ON CONSTRAINT audit_log_entity_type_check ON public.audit_log IS
  'Restaurado por 091_rollback a la lista de 089 (9 entidades). Re-aplicar 091 (o migracion posterior) reintroduce agency_contact.';
