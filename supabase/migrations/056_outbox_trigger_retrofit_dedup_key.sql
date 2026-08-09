-- ============================================================
-- 056_outbox_trigger_retrofit_dedup_key.sql
-- WKR-007.2 — reservation.created publication idempotency
--
-- Retrofitting the existing trigger function with a deterministic
-- dedup_key. CREATE OR REPLACE preserves the function owner and ACL.
-- The existing trigger is not recreated or modified.
-- ============================================================

CREATE OR REPLACE FUNCTION public.outbox_emit_reservation_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  'WKR-007.2: AFTER INSERT on reservations emits idempotent reservation.created.v1 in the same transaction using dedup_key.';

