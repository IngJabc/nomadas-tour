-- ============================================================
-- WKR-007 Fase 0 / 0.1 — schema verification
--
-- Pegar completo en Supabase → SQL Editor → Run
-- SQL puro (sin \echo). Ejecutar DESPUÉS de aplicar 052–055.
--
-- Nota MEDIUM-1 / SQL Editor: Supabase suele ejecutar el script entero
-- en UNA sola transacción, así que NOW() (usado por update_updated_at)
-- no avanza entre statements. El probe de updated_at siembra un valor
-- antiguo en el INSERT y comprueba que el trigger lo sube en el UPDATE.
-- ============================================================

-- 1) trips.created_at + trigger updated_at
DO $$
DECLARE
  v_default TEXT;
  v_nullable TEXT;
BEGIN
  SELECT column_default, is_nullable
  INTO v_default, v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'trips'
    AND column_name = 'created_at';

  IF v_default IS NULL OR v_default NOT ILIKE '%now()%' THEN
    RAISE EXCEPTION 'FAIL: trips.created_at missing DEFAULT NOW()';
  END IF;
  IF v_nullable <> 'NO' THEN
    RAISE EXCEPTION 'FAIL: trips.created_at must be NOT NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM public.trips WHERE created_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL: existing trips missing created_at';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'trips'
      AND t.tgname = 'trips_updated_at'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAIL: trips_updated_at trigger missing';
  END IF;

  RAISE NOTICE 'PASS: trips.created_at + trips_updated_at';
END $$;

-- 2) INSERT (seeded updated_at) → UPDATE → trigger bumps updated_at → DELETE
-- Works inside a single SQL-Editor transaction (NOW() is TX-stable).
DO $$
DECLARE
  v_route_id UUID;
  v_trip_id UUID := gen_random_uuid();
  v_created TIMESTAMPTZ;
  v_before TIMESTAMPTZ;
  v_after TIMESTAMPTZ;
  v_seed TIMESTAMPTZ := '2000-01-01'::timestamptz;
BEGIN
  SELECT id INTO v_route_id FROM public.routes LIMIT 1;
  IF v_route_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: need a routes fixture for trip insert test';
  END IF;

  INSERT INTO public.trips (
    id, route_id, departure_time, capacity, vehicle_type, status, updated_at
  ) VALUES (
    v_trip_id,
    v_route_id,
    clock_timestamp() + INTERVAL '2 days',
    10,
    'kia',
    'active',
    v_seed
  )
  RETURNING created_at, updated_at
  INTO v_created, v_before;

  IF v_created IS NULL THEN
    RAISE EXCEPTION 'FAIL: INSERT did not set created_at';
  END IF;

  IF v_before IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'FAIL: expected seeded updated_at=%, got %', v_seed, v_before;
  END IF;

  UPDATE public.trips
  SET capacity = capacity
  WHERE id = v_trip_id
  RETURNING updated_at INTO v_after;

  IF v_after IS NULL OR v_after <= v_seed THEN
    RAISE EXCEPTION
      'FAIL: trips_updated_at trigger did not bump updated_at (got %)',
      v_after;
  END IF;

  DELETE FROM public.trips WHERE id = v_trip_id;

  RAISE NOTICE 'PASS: trip INSERT created_at + UPDATE updated_at (% -> %)',
    v_before, v_after;
END $$;

-- 3) outbox dedup_key: NULLs allowed; non-null unique; ON CONFLICT DO NOTHING (no target)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'outbox_events'
      AND column_name = 'dedup_key'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'FAIL: outbox_events.dedup_key missing or not nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_outbox_events_dedup_key_unique'
  ) THEN
    RAISE EXCEPTION 'FAIL: idx_outbox_events_dedup_key_unique missing';
  END IF;

  RAISE NOTICE 'PASS: outbox_events.dedup_key column + unique partial index';
END $$;

BEGIN;

DO $$
DECLARE
  v_id1 UUID := gen_random_uuid();
  v_id2 UUID := gen_random_uuid();
  v_id3 UUID := gen_random_uuid();
  v_agg UUID := gen_random_uuid();
  v_key TEXT;
  v_rows INTEGER;
BEGIN
  v_key := 'trip.created:' || v_agg::text;

  INSERT INTO public.outbox_events (
    id, event_type, event_version, aggregate_type, aggregate_id, payload, dedup_key
  ) VALUES
    (v_id1, 'test.phase0', 1, 'test', v_agg, '{}'::jsonb, NULL),
    (v_id2, 'test.phase0', 1, 'test', v_agg, '{}'::jsonb, NULL);

  INSERT INTO public.outbox_events (
    id, event_type, event_version, aggregate_type, aggregate_id, payload, dedup_key
  ) VALUES
    (v_id3, 'test.phase0', 1, 'test', v_agg, '{}'::jsonb, v_key);

  BEGIN
    INSERT INTO public.outbox_events (
      event_type, event_version, aggregate_type, aggregate_id, payload, dedup_key
    ) VALUES (
      'test.phase0', 1, 'test', v_agg, '{}'::jsonb, v_key
    );
    RAISE EXCEPTION 'FAIL: duplicate dedup_key was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: duplicate dedup_key rejected';
  END;

  INSERT INTO public.outbox_events (
    event_type, event_version, aggregate_type, aggregate_id, payload, dedup_key
  ) VALUES (
    'test.phase0', 1, 'test', v_agg, '{}'::jsonb, v_key
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: ON CONFLICT DO NOTHING (dedup_key) inserted a duplicate';
  END IF;

  INSERT INTO public.outbox_events (
    event_type, event_version, aggregate_type, aggregate_id, payload, dedup_key
  ) VALUES (
    'test.phase0', 1, 'test', v_agg, '{}'::jsonb, 'trip.archived:' || v_agg::text
  );

  RAISE NOTICE 'PASS: multiple NULL dedup_key + distinct keys + ON CONFLICT DO NOTHING';
END $$;

ROLLBACK;

-- 4) notifications.source_event_id — cases A–F
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'source_event_id'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'FAIL: notifications.source_event_id missing or not nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_notifications_source_event_idempotent'
  ) THEN
    RAISE EXCEPTION 'FAIL: idx_notifications_source_event_idempotent missing';
  END IF;

  RAISE NOTICE 'PASS: notifications.source_event_id + index';
END $$;

BEGIN;

DO $$
DECLARE
  v_event UUID := gen_random_uuid();
  v_event2 UUID := gen_random_uuid();
  v_agency_a UUID;
  v_agency_b UUID;
  v_entity UUID := gen_random_uuid();
  v_rows INTEGER;
  v_count INTEGER;
BEGIN
  SELECT a.id, b.id
  INTO v_agency_a, v_agency_b
  FROM public.agencies a
  JOIN public.agencies b ON b.id <> a.id
  LIMIT 1;

  IF v_agency_a IS NULL OR v_agency_b IS NULL THEN
    RAISE EXCEPTION 'FAIL: need at least two agencies for source_event_id cases';
  END IF;

  -- E) source_event_id IS NULL → multiple rows allowed
  INSERT INTO public.notifications (
    type, title, body, entity_type, entity_id, agency_id, recipient_role, source_event_id
  ) VALUES
    ('trip_created', 't', 'b', 'trip', v_entity, v_agency_a, 'agency', NULL),
    ('trip_created', 't', 'b', 'trip', v_entity, v_agency_a, 'agency', NULL);

  RAISE NOTICE 'PASS: E) NULL source_event_id unconstrained';

  -- A) same event + same agency + same role → duplicate rejected
  INSERT INTO public.notifications (
    type, title, body, entity_type, entity_id, agency_id, recipient_role, source_event_id
  ) VALUES (
    'trip_created', 't', 'b', 'trip', v_entity, v_agency_a, 'agency', v_event
  );

  BEGIN
    INSERT INTO public.notifications (
      type, title, body, entity_type, entity_id, agency_id, recipient_role, source_event_id
    ) VALUES (
      'trip_created', 't', 'b', 'trip', v_entity, v_agency_a, 'agency', v_event
    );
    RAISE EXCEPTION 'FAIL: A) duplicate source_event_id+agency+role accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: A) duplicate logical notification rejected';
  END;

  -- F) future path: ON CONFLICT DO NOTHING without conflict_target
  INSERT INTO public.notifications (
    type, title, body, entity_type, entity_id, agency_id, recipient_role, source_event_id
  ) VALUES (
    'trip_created', 't', 'b', 'trip', v_entity, v_agency_a, 'agency', v_event
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: F) ON CONFLICT DO NOTHING inserted a duplicate';
  END IF;
  RAISE NOTICE 'PASS: F) ON CONFLICT DO NOTHING (no target) skips duplicate';

  -- B) same event + different agency → allowed
  INSERT INTO public.notifications (
    type, title, body, entity_type, entity_id, agency_id, recipient_role, source_event_id
  ) VALUES (
    'trip_created', 't', 'b', 'trip', v_entity, v_agency_b, 'agency', v_event
  );
  RAISE NOTICE 'PASS: B) same event + different agency allowed';

  -- C) same event + different role → allowed
  INSERT INTO public.notifications (
    type, title, body, entity_type, entity_id, agency_id, recipient_role, source_event_id
  ) VALUES (
    'trip_created', 't', 'b', 'trip', v_entity, v_agency_a, 'superadmin', v_event
  );
  RAISE NOTICE 'PASS: C) same event + different role allowed';

  -- D) agency_id IS NULL + recipient_role=superadmin → works + dedupes
  INSERT INTO public.notifications (
    type, title, body, entity_type, entity_id, agency_id, recipient_role, source_event_id
  ) VALUES (
    'trip_created', 't', 'b', 'trip', v_entity, NULL, 'superadmin', v_event2
  );

  INSERT INTO public.notifications (
    type, title, body, entity_type, entity_id, agency_id, recipient_role, source_event_id
  ) VALUES (
    'trip_created', 't', 'b', 'trip', v_entity, NULL, 'superadmin', v_event2
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FAIL: D) superadmin NULL agency duplicate was inserted';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.notifications
  WHERE source_event_id = v_event2
    AND agency_id IS NULL
    AND recipient_role = 'superadmin';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: D) expected exactly 1 superadmin row, got %', v_count;
  END IF;

  RAISE NOTICE 'PASS: D) agency_id NULL + superadmin insert + dedupe';
END $$;

ROLLBACK;

-- 5) email_delivery_log — PK, checks, columns, RLS, grants
DO $$
DECLARE
  v_pk_ok BOOLEAN;
  v_rls BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'email_delivery_log'
  ) THEN
    RAISE EXCEPTION 'FAIL: email_delivery_log missing';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.email_delivery_log'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) ILIKE '%event_id%'
      AND pg_get_constraintdef(oid) ILIKE '%recipient_id%'
      AND pg_get_constraintdef(oid) ILIKE '%email_type%'
  ) INTO v_pk_ok;

  IF NOT v_pk_ok THEN
    RAISE EXCEPTION 'FAIL: email_delivery_log PK (event_id, recipient_id, email_type) missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.email_delivery_log'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%pending%'
      AND pg_get_constraintdef(oid) ILIKE '%sent%'
  ) THEN
    RAISE EXCEPTION 'FAIL: email_delivery_log status CHECK (pending/sent) missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.email_delivery_log'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%attempts%'
  ) THEN
    RAISE EXCEPTION 'FAIL: email_delivery_log attempts >= 0 CHECK missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_delivery_log'
      AND column_name = 'sent_at'
  ) THEN
    RAISE EXCEPTION 'FAIL: email_delivery_log.sent_at missing';
  END IF;

  SELECT relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'email_delivery_log';

  IF NOT COALESCE(v_rls, FALSE) THEN
    RAISE EXCEPTION 'FAIL: email_delivery_log RLS not enabled';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.email_delivery_log', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.email_delivery_log', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.email_delivery_log', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.email_delivery_log', 'DELETE')
  THEN
    RAISE EXCEPTION 'FAIL: service_role missing expected privileges on email_delivery_log';
  END IF;

  IF has_table_privilege('anon', 'public.email_delivery_log', 'SELECT')
     OR has_table_privilege('anon', 'public.email_delivery_log', 'INSERT')
     OR has_table_privilege('authenticated', 'public.email_delivery_log', 'SELECT')
     OR has_table_privilege('authenticated', 'public.email_delivery_log', 'INSERT')
  THEN
    RAISE EXCEPTION 'FAIL: anon/authenticated must not have direct table access to email_delivery_log';
  END IF;

  RAISE NOTICE 'PASS: email_delivery_log PK/checks/RLS/grants';
END $$;

BEGIN;

DO $$
DECLARE
  v_event UUID := gen_random_uuid();
  v_recipient UUID := gen_random_uuid();
BEGIN
  INSERT INTO public.email_delivery_log (
    event_id, recipient_id, email_type, status, attempts
  ) VALUES (
    v_event, v_recipient, 'trip_created', 'pending', 0
  );

  BEGIN
    INSERT INTO public.email_delivery_log (
      event_id, recipient_id, email_type, status, attempts
    ) VALUES (
      v_event, v_recipient, 'trip_created', 'pending', 0
    );
    RAISE EXCEPTION 'FAIL: duplicate email_delivery_log PK accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: email_delivery_log PK rejects duplicates';
  END;

  BEGIN
    INSERT INTO public.email_delivery_log (
      event_id, recipient_id, email_type, status, attempts
    ) VALUES (
      gen_random_uuid(), gen_random_uuid(), 'trip_created', 'bogus', 0
    );
    RAISE EXCEPTION 'FAIL: invalid status accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: email_delivery_log status CHECK rejects invalid';
  END;

  BEGIN
    INSERT INTO public.email_delivery_log (
      event_id, recipient_id, email_type, status, attempts
    ) VALUES (
      gen_random_uuid(), gen_random_uuid(), 'trip_created', 'pending', -1
    );
    RAISE EXCEPTION 'FAIL: negative attempts accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: email_delivery_log attempts CHECK rejects negative';
  END;

  UPDATE public.email_delivery_log
  SET status = 'sent', sent_at = clock_timestamp(), attempts = 1
  WHERE event_id = v_event
    AND recipient_id = v_recipient
    AND email_type = 'trip_created';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: could not mark email_delivery_log as sent';
  END IF;

  RAISE NOTICE 'PASS: email_delivery_log pending→sent path';
END $$;

ROLLBACK;

-- 6) trigger 049 intact
DO $$
BEGIN
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
    RAISE EXCEPTION 'FAIL: trg_reservations_outbox_created missing after Fase 0';
  END IF;

  RAISE NOTICE 'PASS: reservation.created trigger 049 intact';
END $$;
