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

/* ------------------------------------------------------------------ */
/*  Availability checks                                                */
/* ------------------------------------------------------------------ */

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
  patchLinkData: (
    linkId: string,
    agencyId: string,
    linkData: Record<string, unknown>,
  ) => Promise<void>;
  createBoardingScenario: (
    agencyId: string,
    actorUserId: string,
  ) => Promise<{ tripId: string; seatId: string; reservationId: string; passengerId: string }>;
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

/**
 * Create a complete boarding scenario:
 *   1. Future trip (departure > NOW) so create_agency_reservation works
 *   2. Assign agency
 *   3. Create dedicated seat
 *   4. Create reservation + passenger via create_agency_reservation
 *   5. Flip trip to past (departure <= NOW) so boarding_toggle works
 */
async function createBoardingScenario(
  client: pg.Client,
  agencyId: string,
  actorUserId: string,
): Promise<{ tripId: string; seatId: string; reservationId: string; passengerId: string }> {
  const tripRes = await client.query(
    `INSERT INTO public.trips (route_id, status, departure_time, capacity, vehicle_type) VALUES ($1, 'active', NOW() + INTERVAL '1 hour', 31, 'bus') RETURNING id`,
    [IDS.ROUTE_1],
  );
  const tripId = tripRes.rows[0].id as string;

  await client.query(
    `INSERT INTO public.trip_agencies (trip_id, agency_id) VALUES ($1, $2)`,
    [tripId, agencyId],
  );

  const seatCode = `BDG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const seatRes = await client.query(
    `INSERT INTO public.seats (trip_id, seat_code, status) VALUES ($1, $2, 'available') RETURNING id`,
    [tripId, seatCode],
  );
  const seatId = seatRes.rows[0].id as string;

  const resResult = await client.query(
    `SELECT public.create_agency_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      tripId,
      agencyId,
      actorUserId,
      'Boarding Booker',
      'DOC-BDG',
      '555-BDG',
      [seatId],
      ['Boarding Pax'],
      ['DOC-PAX-BDG'],
      ['555-PAX-BDG'],
    ],
  );
  const resData = resResult.rows[0]?.create_agency_reservation;
  const reservationId = resData?.reservation_id as string;

  const paxRes = await client.query(
    `SELECT id FROM public.reservation_passengers WHERE reservation_id = $1 LIMIT 1`,
    [reservationId],
  );
  const passengerId = paxRes.rows[0]?.id as string;

  await client.query(
    `UPDATE public.trips SET departure_time = NOW() - INTERVAL '1 hour' WHERE id = $1`,
    [tripId],
  );

  return { tripId, seatId, reservationId, passengerId };
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
    patchLinkData: (linkId: string, agencyId: string, linkData: Record<string, unknown>) =>
      patchLinkData(client, linkId, agencyId, linkData),
    createBoardingScenario: (agencyId: string, actorUserId: string) =>
      createBoardingScenario(client, agencyId, actorUserId),
  };
}
