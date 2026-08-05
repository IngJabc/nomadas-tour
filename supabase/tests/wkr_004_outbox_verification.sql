-- ============================================================
-- WKR-004 — Outbox foundation verification
--
-- Pegar completo en Supabase → SQL Editor → Run
-- SQL puro (sin \echo). Ejecutar DESPUÉS de aplicar 049.
--
-- El bloque de emisión usa BEGIN/ROLLBACK: no deja filas.
-- ============================================================

-- 1) Tabla + índices + grants posture
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'outbox_events';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: outbox_events table missing';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'outbox_events'
    AND indexname IN (
      'idx_outbox_events_status_available_at',
      'idx_outbox_events_aggregate',
      'idx_outbox_events_event_type',
      'idx_outbox_events_created_at'
    );

  IF v_count < 4 THEN
    RAISE EXCEPTION 'FAIL: outbox_events indexes incomplete (%/4)', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'reservations'
      AND t.tgname = 'trg_reservations_outbox_created'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAIL: trg_reservations_outbox_created missing';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'outbox_events';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: outbox_events must not be in supabase_realtime';
  END IF;

  RAISE NOTICE 'PASS: outbox_events structure + trigger + not realtime';
END $$;

-- 2) Emit event via INSERT into reservations (rolled back)
BEGIN;

DO $$
DECLARE
  v_trip_id UUID;
  v_agency_id UUID;
  v_reservation_id UUID := gen_random_uuid();
  v_event public.outbox_events%ROWTYPE;
  v_payload TEXT;
BEGIN
  SELECT t.id, ta.agency_id
  INTO v_trip_id, v_agency_id
  FROM public.trips t
  JOIN public.trip_agencies ta ON ta.trip_id = t.id
  WHERE t.status = 'active'
  LIMIT 1;

  IF v_trip_id IS NULL OR v_agency_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: need active trip with trip_agencies fixture';
  END IF;

  INSERT INTO public.reservations (
    id,
    trip_id,
    agency_id,
    booker_name,
    booker_document,
    qr_code,
    status
  ) VALUES (
    v_reservation_id,
    v_trip_id,
    v_agency_id,
    'WKR-004 Fixture',
    'WKR004DOC',
    'NT-WKR004-TEST-' || REPLACE(v_reservation_id::text, '-', ''),
    'confirmed'
  );

  SELECT * INTO v_event
  FROM public.outbox_events
  WHERE aggregate_type = 'reservation'
    AND aggregate_id = v_reservation_id
    AND event_type = 'reservation.created'
    AND event_version = 1
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'FAIL: outbox event not created for reservation insert';
  END IF;

  IF v_event.status <> 'pending' THEN
    RAISE EXCEPTION 'FAIL: expected status pending, got %', v_event.status;
  END IF;

  IF v_event.tenant_id IS DISTINCT FROM v_agency_id THEN
    RAISE EXCEPTION 'FAIL: tenant_id must equal agency_id';
  END IF;

  IF v_event.payload->>'reservation_id' IS DISTINCT FROM v_reservation_id::text THEN
    RAISE EXCEPTION 'FAIL: payload.reservation_id mismatch';
  END IF;

  IF v_event.payload->>'trip_id' IS DISTINCT FROM v_trip_id::text THEN
    RAISE EXCEPTION 'FAIL: payload.trip_id mismatch';
  END IF;

  IF v_event.payload->>'agency_id' IS DISTINCT FROM v_agency_id::text THEN
    RAISE EXCEPTION 'FAIL: payload.agency_id mismatch';
  END IF;

  v_payload := lower(v_event.payload::text);
  IF position('document' IN v_payload) > 0
     OR position('phone' IN v_payload) > 0
     OR position('email' IN v_payload) > 0
     OR position('qr_code' IN v_payload) > 0
     OR position('"qr"' IN v_payload) > 0 THEN
    RAISE EXCEPTION 'FAIL: payload contains forbidden PII/QR keys: %', v_event.payload;
  END IF;

  RAISE NOTICE 'PASS: reservation.created.v1 emitted with minimal payload';
END $$;

ROLLBACK;

SELECT
  'WKR-004 outbox foundation' AS check_name,
  'PASS' AS status,
  'table + trigger emit reservation.created.v1 (fixture rolled back)' AS detail;
