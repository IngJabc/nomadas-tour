-- SEC-009.3 Tenant Isolation Test Fixtures
-- Deterministic UUIDs, real schema, minimal data.
-- NOT idempotent: fails if fixture data already exists (cleanup runs separately).

-- =============================================================================
-- 1. Agencies
-- =============================================================================
INSERT INTO public.agencies (id, name, subdomain, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Agency A (TI Test)', 'test-tenant-a', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'Agency B (TI Test)', 'test-tenant-b', 'active');

-- =============================================================================
-- 2. Auth users (GoTrue-compatible: instance_id, token columns, raw_app_meta_data)
--    Token columns MUST be '' (not NULL) — GoTrue's Go driver crashes on NULL-to-string.
--    instance_id = zero UUID for single-tenant local Supabase.
-- =============================================================================
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, recovery_token,
  email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'authenticated', 'authenticated',
    'user-a@tenant-test.local',
    '',
    NOW(), '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'authenticated', 'authenticated',
    'user-b@tenant-test.local',
    '',
    NOW(), '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    NOW(), NOW()
  );

-- =============================================================================
-- 2b. Auth identities (required for email/password sign-in via GoTrue)
--     provider_id = user UUID as text for email provider.
-- =============================================================================
INSERT INTO auth.identities (
  id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
) VALUES
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","email":"user-a@tenant-test.local","email_verified":true}'::jsonb,
    'email', NOW(), NOW(), NOW()
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","email":"user-b@tenant-test.local","email_verified":true}'::jsonb,
    'email', NOW(), NOW(), NOW()
  );

-- =============================================================================
-- 3. Public users (FK → auth.users, FK → agencies)
-- =============================================================================
INSERT INTO public.users (id, email, password_hash, role, agency_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user-a@tenant-test.local', '', 'agency', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'user-b@tenant-test.local', '', 'agency', '22222222-2222-2222-2222-222222222222');

-- =============================================================================
-- 4. Routes (public read, needed for trips)
-- =============================================================================
INSERT INTO public.routes (id, origin, destination, status) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Test Origin', 'Test Destination', 'active');

-- =============================================================================
-- 5. Trips (FK → routes, FK → auth.users via created_by)
-- =============================================================================
INSERT INTO public.trips (id, route_id, departure_time, capacity, vehicle_type, status, created_by) VALUES
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', NOW() + INTERVAL '2 hours', 31, 'bus', 'active', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', NOW() + INTERVAL '3 hours', 31, 'bus', 'active', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- =============================================================================
-- 6. Trip agencies (assignment: A→tripA, B→tripB)
-- =============================================================================
INSERT INTO public.trip_agencies (id, trip_id, agency_id) VALUES
  ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111'),
  ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222');

-- =============================================================================
-- 7. Seats (one per trip, A1)
-- =============================================================================
INSERT INTO public.seats (id, trip_id, seat_code, status) VALUES
  ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', 'A1', 'available'),
  ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', 'A1', 'available');

-- =============================================================================
-- 8. Reservations (one per agency)
-- =============================================================================
INSERT INTO public.reservations (id, agency_id, trip_id, created_by, booker_name, booker_document, booker_phone, qr_code, status) VALUES
  ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Booker A', 'DOC-A', '555-0001', 'QR-TI-A1', 'confirmed'),
  ('99999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222', '55555555-5555-5555-5555-555555555555', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Booker B', 'DOC-B', '555-0002', 'QR-TI-B1', 'confirmed');

-- =============================================================================
-- 9. Reservation passengers (one per reservation, one seat each)
-- =============================================================================
INSERT INTO public.reservation_passengers (id, reservation_id, seat_id, name, document, status) VALUES
  ('a1111111-a111-a111-a111-a11111111111', '88888888-8888-8888-8888-888888888888', '66666666-6666-6666-6666-666666666666', 'Passenger A', 'DOC-PA', 'active'),
  ('b2222222-b222-b222-b222-b22222222222', '99999999-9999-9999-9999-999999999999', '77777777-7777-7777-7777-777777777777', 'Passenger B', 'DOC-PB', 'active');

-- =============================================================================
-- 10. Reservation links (one per agency)
-- =============================================================================
INSERT INTO public.reservation_links (id, token_hash, trip_id, agency_id, created_by, status, expires_at) VALUES
  ('c1111111-c111-c111-c111-c11111111111', 'hash-token-a', '44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'active', NOW() + INTERVAL '7 days'),
  ('d2222222-d222-d222-d222-d22222222222', 'hash-token-b', '55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'active', NOW() + INTERVAL '7 days');

-- =============================================================================
-- 11. Notifications (one per agency)
-- =============================================================================
INSERT INTO public.notifications (id, type, title, body, entity_type, entity_id, agency_id, recipient_role) VALUES
  ('e1111111-e111-e111-e111-e11111111111', 'reservation_created', 'Test Notification A', 'Body for A', 'reservation', '88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'agency'),
  ('f2222222-f222-f222-f222-f22222222222', 'reservation_created', 'Test Notification B', 'Body for B', 'reservation', '99999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222', 'agency');

-- =============================================================================
-- 12. Agency settings (one per agency, defaults for colors)
-- =============================================================================
INSERT INTO public.agency_settings (agency_id) VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

-- =============================================================================
-- 13. Agency notification preferences (one category per agency)
-- =============================================================================
INSERT INTO public.agency_notification_preferences (agency_id, category, in_app_enabled, email_enabled) VALUES
  ('11111111-1111-1111-1111-111111111111', 'trip_assignments', true, true),
  ('22222222-2222-2222-2222-222222222222', 'trip_assignments', true, true);

-- =============================================================================
-- 14. Audit log (one entry per agency, manually seeded for determinism)
-- =============================================================================
INSERT INTO public.audit_log (id, occurred_at, actor_user_id, actor_role, agency_id, action, entity_type, entity_id) VALUES
  ('aa111111-aa11-aa11-aa11-aa1111111111', NOW(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'agency', '11111111-1111-1111-1111-111111111111', 'reservation.created', 'reservation', '88888888-8888-8888-8888-888888888888'),
  ('bb222222-bb22-bb22-bb22-bb2222222222', NOW(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'agency', '22222222-2222-2222-2222-222222222222', 'reservation.created', 'reservation', '99999999-9999-9999-9999-999999999999');

-- =============================================================================
-- 15. Runtime GRANTs for authenticated role
-- These ensure RLS is the isolation mechanism, not missing grants.
-- Migrations only grant SELECT on audit_log (065), reservation_links (070),
-- and superadmin_notification_preferences (062). All other tenant-scoped tables
-- need explicit GRANTs for authenticated to exercise RLS policies.
-- =============================================================================
GRANT SELECT ON public.agencies TO authenticated;
GRANT SELECT ON public.users TO authenticated;
GRANT SELECT ON public.routes TO authenticated;
GRANT SELECT ON public.trips TO authenticated;
GRANT SELECT ON public.seats TO authenticated;
GRANT SELECT ON public.trip_agencies TO authenticated;
GRANT SELECT ON public.reservations TO authenticated;
GRANT SELECT ON public.reservation_passengers TO authenticated;
GRANT SELECT ON public.reservation_links TO authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT SELECT ON public.agency_notification_preferences TO authenticated;
GRANT SELECT ON public.agency_settings TO authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT ON public.boarding_logs TO authenticated;
