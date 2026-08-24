/**
 * @vitest-environment node
 *
 * SEC-009.3 — Tenant Isolation Fixture
 *
 * Provides deterministic test data and auth helpers for DB/RLS tenant
 * isolation tests against Supabase Local. Uses parameterized set_config()
 * for JWT claims — no SQL string interpolation.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

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

export function isDbAvailable(): boolean {
  return Boolean(TENANT_DB_URL) && !TENANT_DB_URL.includes('[YOUR-PASSWORD]');
}

export function shouldFailIfNoDb(): boolean {
  return TEST_MODE === 'ci';
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
      [ALL_TRIP_IDS],
    );
    await client.query(
      'DELETE FROM public.seats WHERE trip_id = ANY($1::uuid[])',
      [ALL_TRIP_IDS],
    );
    await client.query(
      'DELETE FROM public.trip_agencies WHERE agency_id = ANY($1::uuid[])',
      [ALL_AGENCY_IDS],
    );
    await client.query(
      'DELETE FROM public.trips WHERE id = ANY($1::uuid[])',
      [ALL_TRIP_IDS],
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
/*  Public API                                                          */
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
 */
export async function createFixture(): Promise<Fixture> {
  const client = new pg.Client({
    connectionString: TENANT_DB_URL,
    ssl: { rejectUnauthorized: false },
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
  };
}
