/**
 * @vitest-environment node
 *
 * SEC-009.3 — Tenant Isolation Fixture
 *
 * Provides deterministic test data and auth helpers for DB/RLS tenant
 * isolation tests against Supabase Local. Uses parameterized set_config()
 * for JWT claims — no SQL string interpolation.
 *
 * Phase 3 additions: Supabase auth helpers for real JWT tokens and
 * Express server lifecycle for full HTTP integration tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/* ------------------------------------------------------------------ */
/*  Deterministic UUIDs                                                */
/* ------------------------------------------------------------------ */

export const IDS = {
  AGENCY_A: '11111111-1111-1111-1111-111111111111',
  AGENCY_B: '22222222-2222-2222-2222-222222222222',
  USER_A: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  USER_B: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  ROUTE_1: '33333333-3333-3333-3333-333333333333',
  TRIP_A: '44444444-4444-4444-4444-444444444444',
  TRIP_B: '55555555-5555-5555-5555-555555555555',
  TA_A: 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  TA_B: 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  SEAT_A1: '66666666-6666-6666-6666-666666666666',
  SEAT_B1: '77777777-7777-7777-7777-777777777777',
  RES_A: '88888888-8888-8888-8888-888888888888',
  RES_B: '99999999-9999-9999-9999-999999999999',
  PAS_A: 'a1111111-a111-a111-a111-a11111111111',
  PAS_B: 'b2222222-b222-b222-b222-b22222222222',
  LINK_A: 'c1111111-c111-c111-c111-c11111111111',
  LINK_B: 'd2222222-d222-d222-d222-d22222222222',
  NOTIF_A: 'e1111111-e111-e111-e111-e11111111111',
  NOTIF_B: 'f2222222-f222-f222-f222-f22222222222',
  AUDIT_A: 'aa111111-aa11-aa11-aa11-aa1111111111',
  AUDIT_B: 'bb222222-bb22-bb22-bb22-bb2222222222',
} as const;

/* ------------------------------------------------------------------ */
/*  Connection                                                         */
/* ------------------------------------------------------------------ */

const TENANT_DB_URL =
  process.env.TENANT_DB_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const TEST_MODE = process.env.TEST_MODE || 'local';

/* ------------------------------------------------------------------ */
/*  Supabase Local defaults (from supabase CLI config.toml)            */
/* ------------------------------------------------------------------ */

const SUPABASE_LOCAL_URL =
  process.env.SUPABASE_URL || 'http://localhost:54321';

const SUPABASE_LOCAL_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ------------------------------------------------------------------ */
/*  Availability checks                                                */
/* ------------------------------------------------------------------ */

export function isDbAvailable(): boolean {
  return Boolean(TENANT_DB_URL) && !TENANT_DB_URL.includes('[YOUR-PASSWORD]');
}

export function shouldFailIfNoDb(): boolean {
  return TEST_MODE === 'ci';
}

export function isSupabaseLocalAvailable(): boolean {
  return SUPABASE_LOCAL_URL.startsWith('http://localhost');
}

/**
 * Probe whether Supabase Local (GoTrue on :54321) is actually reachable.
 * Returns true if the health endpoint responds within 3s.
 */
export async function isSupabaseLocalReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_LOCAL_URL}/health/v1/authorized`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok || res.status === 401 || res.status === 403;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Fixture types                                                      */
/* ------------------------------------------------------------------ */

export interface Fixture {
  client: pg.Client;
  authQuery: (
    userId: string,
    sql: string,
    params?: unknown[],
  ) => Promise<pg.QueryResult>;
  safeAuthQuery: (
    userId: string,
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: pg.RowList; denied?: boolean }>;
  cleanup: () => Promise<void>;
  createReservationLink: (
    actorUserId: string,
    agencyId: string,
    tripId: string,
    seatIds: string[],
  ) => Promise<{ linkId: string; tokenHash: string }>;
  createTempReservation: (
    actorUserId: string,
    agencyId: string,
    tripId: string,
  ) => Promise<string>;
  getLinkIds: () => Promise<{ linkA: string; linkB: string }>;
  createDedicatedSeat: (
    tripId: string,
    lockForUserId?: string,
  ) => Promise<{ seatId: string; seatCode: string }>;
  createPastTrip: (
    agencyId: string,
  ) => Promise<{ tripId: string }>;
  createReservationWithPassenger: (
    tripId: string,
    agencyId: string,
    actorUserId: string,
    seatId: string,
  ) => Promise<{ reservationId: string; passengerId: string }>;
  patchLinkData: (
    linkId: string,
    agencyId: string,
    linkData: Record<string, unknown>,
  ) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Cleanup (idempotent, uses fixed UUIDs only)                        */
/* ------------------------------------------------------------------ */

const ALL_AGENCY_IDS = [IDS.AGENCY_A, IDS.AGENCY_B];
const ALL_USER_IDS = [IDS.USER_A, IDS.USER_B];
const ALL_TRIP_IDS = [IDS.TRIP_A, IDS.TRIP_B];

async function cleanupData(client: pg.Client): Promise<void> {
  await client.query('SET session_replication_role = replica');
  try {
    const tripAgResult = await client.query(
      `SELECT DISTINCT trip_id FROM public.trip_agencies WHERE agency_id = ANY($1::uuid[])`,
      [ALL_AGENCY_IDS],
    );
    const allTripIds = [...new Set([...ALL_TRIP_IDS, ...tripAgResult.rows.map((r: { trip_id: string }) => r.trip_id)])];

    await client.query(
      'DELETE FROM public.reservation_link_seats WHERE link_id IN (SELECT id FROM public.reservation_links WHERE agency_id = ANY($1::uuid[]))',
      [ALL_AGENCY_IDS],
    );
    await client.query(
      'DELETE FROM public.reservation_passengers WHERE reservation_id IN (SELECT id FROM public.reservations WHERE agency_id = ANY($1::uuid[]))',
      [ALL_AGENCY_IDS],
    );
    await client.query(
      'DELETE FROM public.reservations WHERE agency_id = ANY($1::uuid[])',
      [ALL_AGENCY_IDS],
    );
    await client.query(
      'DELETE FROM public.reservation_links WHERE agency_id = ANY($1::uuid[])',
      [ALL_AGENCY_IDS],
    );
    await client.query(
      'DELETE FROM public.boarding_logs WHERE trip_id = ANY($1::uuid[])',
      [allTripIds],
    );
    await client.query(
      'DELETE FROM public.seats WHERE trip_id = ANY($1::uuid[])',
      [allTripIds],
    );
    await client.query(
      'DELETE FROM public.trip_agencies WHERE agency_id = ANY($1::uuid[])',
      [ALL_AGENCY_IDS],
    );
    await client.query(
      'DELETE FROM public.trips WHERE id = ANY($1::uuid[])',
      [allTripIds],
    );
    await client.query(
      'DELETE FROM public.routes WHERE id = $1',
      [IDS.ROUTE_1],
    );
    await client.query(
      'DELETE FROM public.audit_log WHERE agency_id = ANY($1::uuid[])',
      [ALL_AGENCY_IDS],
    );
    await client.query(
      'DELETE FROM public.notifications WHERE agency_id = ANY($1::uuid[])',
      [ALL_AGENCY_IDS],
    );
    await client.query(
      'DELETE FROM public.agency_notification_preferences WHERE agency_id = ANY($1::uuid[])',
      [ALL_AGENCY_IDS],
    );
    await client.query(
      'DELETE FROM public.agency_settings WHERE agency_id = ANY($1::uuid[])',
      [ALL_AGENCY_IDS],
    );
    await client.query(
      'DELETE FROM public.users WHERE id = ANY($1::uuid[])',
      [ALL_USER_IDS],
    );
    await client.query(
      'DELETE FROM auth.users WHERE id = ANY($1::uuid[])',
      [ALL_USER_IDS],
    );
    await client.query(
      'DELETE FROM public.agencies WHERE id = ANY($1::uuid[])',
      [ALL_AGENCY_IDS],
    );
  } finally {
    await client.query('SET session_replication_role = origin');
  }
}

/* ------------------------------------------------------------------ */
/*  Seed (from supabase/seed.sql)                                       */
/* ------------------------------------------------------------------ */

async function seedData(client: pg.Client): Promise<void> {
  const seedPath = path.join(REPO_ROOT, 'supabase', 'seed.sql');
  const sql = fs.readFileSync(seedPath, 'utf8');
  await client.query(sql);
}

/* ------------------------------------------------------------------ */
/*  Grant helpers (idempotent, fixture setup only)                      */
/* ------------------------------------------------------------------ */

const GRANT_TABLES = [
  'agencies',
  'users',
  'routes',
  'trips',
  'seats',
  'trip_agencies',
  'reservations',
  'reservation_passengers',
  'reservation_links',
  'notifications',
  'agency_notification_preferences',
  'agency_settings',
  'audit_log',
  'boarding_logs',
];

async function ensureGrants(client: pg.Client): Promise<void> {
  for (const table of GRANT_TABLES) {
    await client.query(`GRANT SELECT ON public.${table} TO authenticated`);
  }
}

/* ------------------------------------------------------------------ */
/*  Auth query helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Run SQL as an authenticated user within its own transaction.
 * Uses parameterized set_config() — no SQL string interpolation.
 * Commits on success, rolls back on error.
 */
async function authQuery(
  client: pg.Client,
  userId: string,
  sql: string,
  params?: unknown[],
): Promise<pg.QueryResult> {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL role = authenticated');
    await client.query(
      "SELECT set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userId, role: 'authenticated' })],
    );
    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * Safe variant that catches permission denied errors.
 * Returns { denied: true } when the error indicates missing grants.
 * Returns { rows, denied: false } on success.
 *
 * Convention:
 *   denied: false + rows.length === 0  → RLS isolation PASS
 *   denied: true                       → setup FAIL (missing GRANT)
 */
async function safeAuthQuery(
  client: pg.Client,
  userId: string,
  sql: string,
  params?: unknown[],
): Promise<{ rows: pg.RowList; denied?: boolean }> {
  try {
    const result = await authQuery(client, userId, sql, params);
    return { rows: result.rows, denied: false };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/permission denied/i.test(msg)) {
      return { rows: [], denied: true };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/*  Test Data Helpers (service_role caller)                             */
/* ------------------------------------------------------------------ */

/**
 * Create a reservation link for testing.
 * Uses service_role (base client) to call create_reservation_link RPC.
 * Returns the created link_id and token_hash.
 */
async function createReservationLink(
  client: pg.Client,
  actorUserId: string,
  agencyId: string,
  tripId: string,
  seatIds: string[],
): Promise<{ linkId: string; tokenHash: string }> {
  for (const seatId of seatIds) {
    await client.query(
      `UPDATE public.seats SET status = 'locked', locked_by = $2, locked_at = NOW(), lock_expires_at = NOW() + INTERVAL '600 seconds' WHERE id = $1 AND trip_id = $3`,
      [seatId, actorUserId, tripId],
    );
  }

  const tokenHash = `test-token-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const result = await client.query(
    `SELECT public.create_reservation_link($1, $2, $3, $4, $5)`,
    [tripId, agencyId, actorUserId, tokenHash, seatIds],
  );
  const data = result.rows[0]?.create_reservation_link;
  const linkId = data?.link_id ?? data?.id;
  if (!linkId) {
    throw new Error('Failed to create reservation link: ' + JSON.stringify(result.rows));
  }
  return { linkId, tokenHash };
}

/**
 * Create a temporary reservation for cancel_agency_reservation tests.
 * Uses service_role (base client) to call create_agency_reservation RPC.
 * Returns the reservation_id.
 */
async function createTempReservation(
  client: pg.Client,
  actorUserId: string,
  agencyId: string,
  tripId: string,
): Promise<string> {
  const seatCode = `TRES-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ins = await client.query(
    `INSERT INTO public.seats (trip_id, seat_code, status) VALUES ($1, $2, 'available') RETURNING id`,
    [tripId, seatCode],
  );
  const seatId = ins.rows[0].id;

  const result = await client.query(
    `SELECT public.create_agency_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      tripId,
      agencyId,
      actorUserId,
      'Temp Booker',
      'DOC-TEMP',
      '555-TEMP',
      [seatId],
      ['Temp Passenger'],
      ['DOC-PT'],
      ['555-PT'],
    ],
  );
  const resId = result.rows[0]?.create_agency_reservation?.reservation_id ?? result.rows[0]?.reservation_id ?? result.rows[0]?.id;
  if (!resId) {
    throw new Error('Failed to create temp reservation: ' + JSON.stringify(result.rows));
  }
  return resId;
}

/**
 * Get the actual link IDs from the seeded data.
 * Returns { linkA: string, linkB: string } where linkA belongs to AGENCY_A, linkB to AGENCY_B.
 */
async function getLinkIds(client: pg.Client): Promise<{ linkA: string; linkB: string }> {
  const result = await client.query(
    `SELECT id, agency_id FROM public.reservation_links WHERE id IN ($1, $2)`,
    [IDS.LINK_A, IDS.LINK_B],
  );
  let linkA = IDS.LINK_A;
  let linkB = IDS.LINK_B;
  for (const row of result.rows) {
    if (row.agency_id === IDS.AGENCY_A) linkA = row.id;
    else if (row.agency_id === IDS.AGENCY_B) linkB = row.id;
  }
  return { linkA, linkB };
}

/* ------------------------------------------------------------------ */
/*  Dedicated resource helpers (test isolation)                         */
/* ------------------------------------------------------------------ */

async function createDedicatedSeat(
  client: pg.Client,
  tripId: string,
  lockForUserId?: string,
): Promise<{ seatId: string; seatCode: string }> {
  const seatCode = `SEC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ins = await client.query(
    `INSERT INTO public.seats (trip_id, seat_code, status) VALUES ($1, $2, 'available') RETURNING id, seat_code`,
    [tripId, seatCode],
  );
  const seatId = ins.rows[0].id;
  const code = ins.rows[0].seat_code;
  if (lockForUserId) {
    await client.query(
      `UPDATE public.seats SET status = 'locked', locked_by = $2, locked_at = NOW(), lock_expires_at = NOW() + INTERVAL '600 seconds' WHERE id = $1`,
      [seatId, lockForUserId],
    );
  }
  return { seatId, seatCode: code };
}

async function createPastTrip(
  client: pg.Client,
  agencyId: string,
): Promise<{ tripId: string }> {
  const res = await client.query(
    `INSERT INTO public.trips (route_id, status, departure_time, capacity, vehicle_type) VALUES ($1, 'active', NOW() - INTERVAL '1 hour', 31, 'bus') RETURNING id`,
    [IDS.ROUTE_1],
  );
  const tripId = res.rows[0].id;
  await client.query(
    `INSERT INTO public.trip_agencies (trip_id, agency_id) VALUES ($1, $2)`,
    [tripId, agencyId],
  );
  return { tripId };
}

async function createReservationWithPassenger(
  client: pg.Client,
  tripId: string,
  agencyId: string,
  actorUserId: string,
  seatId: string,
): Promise<{ reservationId: string; passengerId: string }> {
  const result = await client.query(
    `SELECT public.create_agency_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      tripId,
      agencyId,
      actorUserId,
      'Test Booker',
      'DOC-BOOKER',
      '555-BOOK',
      [seatId],
      ['Test Pax'],
      ['DOC-PAX'],
      ['555-PAX'],
    ],
  );
  const data = result.rows[0]?.create_agency_reservation;
  const reservationId = data?.reservation_id;
  const pax = await client.query(
    `SELECT id FROM public.reservation_passengers WHERE reservation_id = $1 LIMIT 1`,
    [reservationId],
  );
  return { reservationId, passengerId: pax.rows[0]?.id };
}

async function patchLinkData(
  client: pg.Client,
  linkId: string,
  agencyId: string,
  linkData: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `SELECT public.patch_reservation_link_data($1, $2, $3)`,
    [linkId, agencyId, JSON.stringify(linkData)],
  );
}

/* ------------------------------------------------------------------ */
/*  Public API — DB/RLS Fixture                                         */
/* ------------------------------------------------------------------ */

/**
 * Create and return the tenant isolation fixture.
 *
 * Must be called inside a Vitest beforeAll with a 30s timeout.
 * The returned fixture provides:
 *   - client: raw pg.Client (connected)
 *   - authQuery(userId, sql): parameterized authenticated query
 *   - safeAuthQuery(userId, sql): catches permission denied
 *   - cleanup(): idempotent teardown of test data
 *   - createReservationLink(actorUserId, agencyId, tripId, seatIds): create link via RPC
 *   - createTempReservation(actorUserId, agencyId, tripId, seatId): create temp reservation
 *   - getLinkIds(): get actual link IDs by agency ownership
 */
export async function createFixture(): Promise<Fixture> {
  const client = new pg.Client({
    connectionString: TENANT_DB_URL,
  });
  await client.connect();

  await cleanupData(client);
  await seedData(client);
  await ensureGrants(client);

  return {
    client,
    authQuery: (userId: string, sql: string, params?: unknown[]) =>
      authQuery(client, userId, sql, params),
    safeAuthQuery: (userId: string, sql: string, params?: unknown[]) =>
      safeAuthQuery(client, userId, sql, params),
    cleanup: () => cleanupData(client),
    createReservationLink: (actorUserId: string, agencyId: string, tripId: string, seatIds: string[]) =>
      createReservationLink(client, actorUserId, agencyId, tripId, seatIds),
    createTempReservation: (actorUserId: string, agencyId: string, tripId: string) =>
      createTempReservation(client, actorUserId, agencyId, tripId),
    getLinkIds: () => getLinkIds(client),
    createDedicatedSeat: (tripId: string, lockForUserId?: string) =>
      createDedicatedSeat(client, tripId, lockForUserId),
    createPastTrip: (agencyId: string) =>
      createPastTrip(client, agencyId),
    createReservationWithPassenger: (tripId: string, agencyId: string, actorUserId: string, seatId: string) =>
      createReservationWithPassenger(client, tripId, agencyId, actorUserId, seatId),
    patchLinkData: (linkId: string, agencyId: string, linkData: Record<string, unknown>) =>
      patchLinkData(client, linkId, agencyId, linkData),
  };
}

/* ================================================================== */
/*  Phase 3 — API Authorization Helpers                                */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/*  Supabase auth clients (lazy — only created when key is available)  */
/* ------------------------------------------------------------------ */

let _supabaseAdmin: ReturnType<typeof createClient> | null = null;
let _supabaseAuth: ReturnType<typeof createClient> | null = null;

function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    if (!SUPABASE_LOCAL_SERVICE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not available');
    }
    _supabaseAdmin = createClient(SUPABASE_LOCAL_URL, SUPABASE_LOCAL_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabaseAdmin;
}

function getSupabaseAuth() {
  if (!_supabaseAuth) {
    if (!SUPABASE_LOCAL_SERVICE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not available');
    }
    _supabaseAuth = createClient(SUPABASE_LOCAL_URL, SUPABASE_LOCAL_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _supabaseAuth;
}

/* ------------------------------------------------------------------ */
/*  Auth user management                                               */
/* ------------------------------------------------------------------ */

/**
 * Set a password for an auth user created by the seed.
 * Uses the Supabase admin API to update the user's encrypted_password.
 */
export async function setAuthPassword(
  userId: string,
  password: string,
): Promise<void> {
  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(userId, {
    password,
  });
  if (error) {
    throw new Error(`Failed to set password for ${userId}: ${error.message}`);
  }
}

/**
 * Sign in as a user and return the access token (JWT).
 * The returned token is valid for the Supabase auth.getUser() validation
 * used by the backend's auth middleware.
 */
export async function signInAndGetToken(
  email: string,
  password: string,
): Promise<string> {
  const { data, error } = await getSupabaseAuth().auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(`Failed to sign in as ${email}: ${error?.message}`);
  }
  return data.session.access_token;
}

/* ------------------------------------------------------------------ */
/*  Express server lifecycle                                           */
/* ------------------------------------------------------------------ */

let serverInstance: Server | null = null;
let serverBaseUrl: string = '';

/**
 * Start the Express backend on a random port.
 * Returns the base URL (e.g. http://127.0.0.1:12345).
 *
 * Sets the required env vars before importing the app module.
 * Must be called once in beforeAll.
 */
export async function startBackendServer(): Promise<string> {
  // Set env vars required by the backend (must be before app import).
  process.env.SUPABASE_URL = SUPABASE_LOCAL_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SUPABASE_LOCAL_SERVICE_KEY;
  process.env.JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
  process.env.NODE_ENV = 'test';
  process.env.CORS_ORIGIN = 'http://localhost:3000';
  process.env.RESEND_API_KEY = 'test-resend';
  process.env.EMAIL_FROM = 'test@example.com';
  process.env.FRONTEND_URL = 'http://localhost:3000';

  // Dynamic import — env vars must already be set.
  const { default: app } = await import(
    '../../backend/src/app.js'
  );

  serverInstance = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });

  const { port } = serverInstance.address() as AddressInfo;
  serverBaseUrl = `http://127.0.0.1:${port}`;
  return serverBaseUrl;
}

/**
 * Stop the Express backend. Must be called in afterAll.
 */
export async function stopBackendServer(): Promise<void> {
  if (!serverInstance) return;
  const closing = serverInstance;
  serverInstance = null;
  serverBaseUrl = '';
  await new Promise<void>((resolve, reject) => {
    closing.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Get the base URL of the running backend server.
 * Throws if server hasn't been started.
 */
export function getBaseUrl(): string {
  if (!serverBaseUrl) {
    throw new Error('Backend server not started. Call startBackendServer() first.');
  }
  return serverBaseUrl;
}

/* ------------------------------------------------------------------ */
/*  API test fixture                                                    */
/* ------------------------------------------------------------------ */

export interface ApiFixture {
  tokenA: string;
  tokenB: string;
  baseUrl: string;
}

/**
 * Create the API test fixture with real JWT tokens.
 *
 * Sets passwords for the seeded auth users, signs in to get real
 * Supabase JWT tokens, and starts the Express backend server.
 *
 * Must be called inside a Vitest beforeAll with a 60s timeout.
 */
export async function createApiFixture(): Promise<ApiFixture> {
  if (!SUPABASE_LOCAL_SERVICE_KEY) {
    if (shouldFailIfNoDb()) {
      throw new Error(
        'SEC-009.3 CI: SUPABASE_SERVICE_ROLE_KEY is not available. ' +
        'Ensure Supabase Local is running and the key is set.',
      );
    }
    throw new Error('skip');
  }

  // Set passwords for seeded auth users
  const PASSWORD_A = 'TestPassword-A-123!';
  const PASSWORD_B = 'TestPassword-B-123!';

  await setAuthPassword(IDS.USER_A, PASSWORD_A);
  await setAuthPassword(IDS.USER_B, PASSWORD_B);

  // Sign in and get real JWT tokens
  const tokenA = await signInAndGetToken('user-a@tenant-test.local', PASSWORD_A);
  const tokenB = await signInAndGetToken('user-b@tenant-test.local', PASSWORD_B);

  // Start backend server
  const baseUrl = await startBackendServer();

  return { tokenA, tokenB, baseUrl };
}

/**
 * Tear down the API test fixture.
 * Stops the backend server.
 */
export async function destroyApiFixture(): Promise<void> {
  await stopBackendServer();
}
