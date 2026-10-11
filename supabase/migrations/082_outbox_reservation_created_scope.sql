-- ============================================================
-- 082_outbox_reservation_created_scope.sql
-- MKT-004 hardening (marketplace) — alcance de reservation.created
--
-- PROBLEMA
--   El trigger de 049 (funcion retroadaptada en 056) emite
--   reservation.created en CUALQUIER INSERT sobre public.reservations,
--   sin mirar source ni status.
--   create_marketplace_reservation (081) inserta con
--   source='marketplace' + status='locked': asientos bloqueados,
--   comprobante todavia NO pagado, fuera del ciclo de tour. Ese INSERT
--   genera hoy una fila en outbox_events que entra al worker.
--
-- POR QUE UNA MIGRACION NUEVA Y NO TOCAR 049/056
--   049 y 056 son historicas y ya aplicadas en el proyecto Supabase
--   compartido: se leen, no se reescriben. El patron ya usado por el
--   marketplace en esta historia compartida (074-081) es agregar el
--   siguiente numero nunca editar el pasado. Como en 056 respecto de
--   049, se usa CREATE OR REPLACE sobre la MISMA funcion, lo que
--   conserva owner, ACL, triggers y search_path ya instalados: la
--   unica superficie que cambia es el cuerpo de la funcion.
--
-- CONDICION APLICADA (minima)
--   INSERT  -> se corta unicamente  source='marketplace' AND status<>'reserved'.
--   tour nunca corta: tour inserta con source='internal' (DEFAULT de 075)
--   y status='confirmed' (RPCs 014/047/066/069), por lo que su comportamiento
--   es identico al actual, byte a byte.
--
-- LIFECYCLE MARKETPLACE (075: locked -> reserved -> cancelled/completed)
--   INSERT  source='marketplace' status='locked'   -> SIN evento   (este fix)
--   INSERT  source='marketplace' status='reserved' -> SI emite     (misma guarda)
--   UPDATE  locked -> reserved                      -> SI emite     (trigger nuevo)
--   tour no usa nunca status='reserved' en reservations, por lo que el
--   trigger de UPDATE es inerte para tour hasta que marketplace lo use.
--
-- IDEMPOTENCIA
--   Ambos caminos usan el dedup_key de 056
--   ('reservation.created:' || id) + ON CONFLICT DO NOTHING sobre el indice
--   unico idx_outbox_events_dedup_key_unique (053): por reserva solo puede
--   existir UN evento reservation.created aunque ambos triggers disparen.
--
-- Dry-run:   BEGIN;  \i 082_outbox_reservation_created_scope.sql   ROLLBACK;
-- Reversa:   ejecutar de nuevo el cuerpo de 056 sobre esta funcion
--            (CREATE OR REPLACE) deja el comportamiento previo.
-- ============================================================

-- ── 1) INSERT: no emitir reservas marketplace sin confirmar ──

CREATE OR REPLACE FUNCTION public.outbox_emit_reservation_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- MKT-004: una reserva marketplace que nace 'locked' todavia no es una
  -- reserva efectiva; no debe disparar efectos de tour (email, fanout).
  -- Cualquier otra fila (tour: source='internal') sigue emitiendo igual.
  IF NEW.source = 'marketplace' AND NEW.status IS DISTINCT FROM 'reserved' THEN
    RETURN NEW;
  END IF;

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
    'reservation.created',
    1,
    'reservation',
    NEW.id,
    NEW.agency_id,
    jsonb_build_object(
      'reservation_id', NEW.id,
      'trip_id', NEW.trip_id,
      'agency_id', NEW.agency_id
    ),
    'pending',
    0,
    NOW(),
    'reservation.created:' || NEW.id::text
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.outbox_emit_reservation_created() IS
  'WKR-004/WKR-007.2 + MKT-004 hardening: AFTER INSERT emite reservation.created.v1 idempotente, salvo reservas marketplace que nacen sin confirmar (source=marketplace AND status<>reserved).';

-- ── 2) UPDATE: marketplace locked -> reserved ────────────────
-- La guarda anterior deja el ciclo marketplace sin emision cuando 005
-- (MKT-005) pase la reserva de 'locked' a 'reserved' por UPDATE: el
-- trigger de INSERT ya no corre. Este trigger cubre esa transicion y
-- solo esa: ninguna fila de tour toca status='reserved' en reservations.

CREATE OR REPLACE FUNCTION public.outbox_emit_reservation_created_on_promotion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source = 'marketplace'
     AND OLD.status = 'locked'
     AND NEW.status = 'reserved' THEN
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
      'reservation.created',
      1,
      'reservation',
      NEW.id,
      NEW.agency_id,
      jsonb_build_object(
        'reservation_id', NEW.id,
        'trip_id', NEW.trip_id,
        'agency_id', NEW.agency_id
      ),
      'pending',
      0,
      NOW(),
      'reservation.created:' || NEW.id::text
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.outbox_emit_reservation_created_on_promotion() IS
  'MKT-004 hardening: AFTER UPDATE emite reservation.created.v1 solo cuando una reserva marketplace transiciona locked -> reserved (075). Inerte para tour: no emite en ningún otro caso.';

DROP TRIGGER IF EXISTS trg_reservations_outbox_created_on_promotion ON public.reservations;

CREATE TRIGGER trg_reservations_outbox_created_on_promotion
  AFTER UPDATE OF status ON public.reservations
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.source = 'marketplace'
    AND OLD.status = 'locked'
    AND NEW.status = 'reserved'
  )
  EXECUTE FUNCTION public.outbox_emit_reservation_created_on_promotion();

-- ── 3) Privilegios (mismo patron que 049) ────────────────────

REVOKE ALL ON FUNCTION public.outbox_emit_reservation_created() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outbox_emit_reservation_created() FROM anon;
REVOKE ALL ON FUNCTION public.outbox_emit_reservation_created() FROM authenticated;

REVOKE ALL ON FUNCTION public.outbox_emit_reservation_created_on_promotion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outbox_emit_reservation_created_on_promotion() FROM anon;
REVOKE ALL ON FUNCTION public.outbox_emit_reservation_created_on_promotion() FROM authenticated;
-- Los triggers corren como owner (SECURITY DEFINER); no se otorga EXECUTE a clientes.
