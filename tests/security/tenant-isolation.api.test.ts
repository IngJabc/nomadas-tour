/**
 * @vitest-environment node
 *
 * SEC-009.3 Phase 3 — Backend API Authorization Tests
 *
 * Tests the full HTTP authorization chain:
 *   real JWT → auth middleware → role middleware → tenant middleware → controller → service → RPC → DB
 *
 * Requires:
 *   - Supabase Local running (http://localhost:54321)
 *   - Database seeded via `supabase db reset` (or fixture seed)
 *
 * Strategy:
 *   - Starts the real Express backend on a random port
 *   - Uses real Supabase JWTs obtained via signInWithPassword()
 *   - Tests HTTP-level tenant isolation (status codes + error contracts)
 *   - Does NOT duplicate RPC/DB coverage from Phase 1/2
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createApiFixture,
  destroyApiFixture,
  isDbAvailable,
  isSupabaseLocalAvailable,
  isSupabaseLocalReachable,
  shouldFailIfNoDb,
  IDS,
  type ApiFixture,
} from './tenant-isolation.fixture';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface ApiResponse {
  status: number;
  body: unknown;
}

/* ------------------------------------------------------------------ */
/*  HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let resBody: unknown;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    resBody = await res.json();
  } else {
    resBody = await res.text();
  }

  return { status: res.status, body: resBody };
}

/* ------------------------------------------------------------------ */
/*  Setup                                                               */
/* ------------------------------------------------------------------ */

let f: ApiFixture;
let canRun = false;

beforeAll(async () => {
  const dbOk = isDbAvailable();
  const localConfigured = isSupabaseLocalAvailable();
  const localReachable = localConfigured
    ? await isSupabaseLocalReachable()
    : false;

  console.log('[SEC-009.3 DEBUG]', {
    dbOk,
    localConfigured,
    localReachable,
    supabaseUrl:
      process.env.SUPABASE_URL || 'http://localhost:54321',
    dbUrlPresent: Boolean(
      process.env.TENANT_DB_URL || process.env.DATABASE_URL,
    ),
    testMode: process.env.TEST_MODE || 'local',
    serviceKeyPresent: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });

  canRun = dbOk && localConfigured && localReachable;
  if (!canRun) {
    if (shouldFailIfNoDb()) {
      throw new Error(
        'SEC-009.3 Phase 3: Supabase Local or DB unavailable in CI mode. ' +
        'Ensure Docker is running and `supabase db reset` has been executed.',
      );
    }
    return;
  }
  f = await createApiFixture();
}, 60_000);

afterAll(async () => {
  if (canRun && f) {
    await destroyApiFixture();
  }
});

/* ------------------------------------------------------------------ */
/*  Skip guard                                                          */
/* ------------------------------------------------------------------ */

function skipIfUnavailable() {
  if (!canRun) return true;
  return false;
}

/* ================================================================== */
/*  TEST SUITE                                                          */
/* ================================================================== */

describe('SEC-009.3 Phase 3 — Backend API Authorization', () => {

  /* ================================================================ */
  /*  1. AUTH MIDDLEWARE                                                */
  /* ================================================================ */

  describe('Auth middleware', () => {
    it('returns 401 without Bearer token', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', '/api/agency/reservations');
      expect(r.status).toBe(401);
      const body = r.body as { error?: { code?: string } };
      expect(body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 with invalid token', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', '/api/agency/reservations', 'invalid-token-abc');
      expect(r.status).toBe(401);
      const body = r.body as { error?: { code?: string } };
      expect(body.error?.code).toBe('UNAUTHORIZED');
    });
  });

  /* ================================================================ */
  /*  2. RESERVATIONS API                                              */
  /* ================================================================ */

  describe('Reservations API', () => {
    it('GET /api/agency/reservations — A reads own = 200 with array', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', '/api/agency/reservations', f.tokenA);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      // Seed has 1 reservation for agency A
      expect(r.body).toHaveLength(1);
      const res = (r.body as any[])[0];
      expect(res.agency_id).toBe(IDS.AGENCY_A);
    });

    it('GET /api/agency/reservations/:id — A reads own = 200', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', `/api/agency/reservations/${IDS.RES_A}`, f.tokenA);
      expect(r.status).toBe(200);
      const body = r.body as any;
      expect(body.reservation_id).toBe(IDS.RES_A);
    });

    it('GET /api/agency/reservations/:id — A reads B = 404 (not found)', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', `/api/agency/reservations/${IDS.RES_B}`, f.tokenA);
      expect(r.status).toBe(404);
      const body = r.body as { error?: { code?: string } };
      expect(body.error?.code).toBe('NOT_FOUND');
    });

    it('POST /api/agency/reservations — A creates on own trip = 201', async () => {
      if (skipIfUnavailable()) return;
      // Create a new seat for this test to avoid conflicts
      const pg = await import('pg');
      const client = new pg.default.Client({
        connectionString: process.env.TENANT_DB_URL || process.env.DATABASE_URL ||
          'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      });
      await client.connect();
      try {
        const seatResult = await client.query(
          `INSERT INTO public.seats (trip_id, seat_code, status) VALUES ($1, 'B1', 'available') RETURNING id`,
          [IDS.TRIP_A],
        );
        const newSeatId = seatResult.rows[0].id;

        const r = await req(f.baseUrl, 'POST', '/api/agency/reservations', f.tokenA, {
          trip_id: IDS.TRIP_A,
          booker_name: 'API Test Booker',
          booker_document: '12345678',
          booker_phone: '555-0199',
          passengers: [{
            seat_id: newSeatId,
            name: 'API Passenger',
            document: '12345678',
            phone: '555-0199',
          }],
        });

        expect(r.status).toBe(201);
        const body = r.body as any;
        expect(body.reservation).toBeDefined();
        expect(body.reservation.agency_id).toBe(IDS.AGENCY_A);
      } finally {
        await client.query('DELETE FROM public.seats WHERE trip_id = $1 AND seat_code = $2', [IDS.TRIP_A, 'B1']);
        await client.end();
      }
    });

    it('POST /api/agency/reservations — A creates on B-only trip = 403', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'POST', '/api/agency/reservations', f.tokenA, {
        trip_id: IDS.TRIP_B,
        booker_name: 'Cross Tenant Booker',
        booker_document: '12345678',
        passengers: [{
          seat_id: IDS.SEAT_B1,
          name: 'Cross Passenger',
          document: '12345678',
        }],
      });
      expect(r.status).toBe(403);
      const body = r.body as { error?: { code?: string } };
      expect(body.error?.code).toBe('FORBIDDEN');
    });

    it('PATCH /api/agency/reservations/:id/cancel — A cancels own = 200', async () => {
      if (skipIfUnavailable()) return;
      // Create a temp reservation to cancel (avoid canceling seed data)
      const pg = await import('pg');
      const client = new pg.default.Client({
        connectionString: process.env.TENANT_DB_URL || process.env.DATABASE_URL ||
          'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      });
      await client.connect();
      try {
        // Create a dedicated seat + reservation for this test
        const seatResult = await client.query(
          `INSERT INTO public.seats (trip_id, seat_code, status) VALUES ($1, 'C1', 'available') RETURNING id`,
          [IDS.TRIP_A],
        );
        const seatId = seatResult.rows[0].id;

        const rpcResult = await client.query(
          `SELECT public.create_agency_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            IDS.TRIP_A, IDS.AGENCY_A, IDS.USER_A,
            'Cancel Booker', '11111111', '555-0200',
            [seatId], ['Cancel Passenger'], ['11111111'], ['555-0200'],
          ],
        );
        const resId = rpcResult.rows[0]?.create_agency_reservation?.reservation_id
          ?? rpcResult.rows[0]?.reservation_id
          ?? rpcResult.rows[0]?.id;

        const r = await req(f.baseUrl, 'PATCH', `/api/agency/reservations/${resId}/cancel`, f.tokenA);
        expect(r.status).toBe(200);
        const body = r.body as any;
        expect(body.cancelled).toBe(true);
      } finally {
        await client.query(
          'DELETE FROM public.reservation_passengers WHERE reservation_id IN (SELECT id FROM public.reservations WHERE agency_id = $1 AND booker_name = $2)',
          [IDS.AGENCY_A, 'Cancel Booker'],
        );
        await client.query(
          'DELETE FROM public.reservations WHERE agency_id = $1 AND booker_name = $2',
          [IDS.AGENCY_A, 'Cancel Booker'],
        );
        await client.query('DELETE FROM public.seats WHERE trip_id = $1 AND seat_code = $2', [IDS.TRIP_A, 'C1']);
        await client.end();
      }
    });

    it('PATCH /api/agency/reservations/:id/cancel — A cancels B = 404', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'PATCH', `/api/agency/reservations/${IDS.RES_B}/cancel`, f.tokenA);
      expect(r.status).toBe(404);
      const body = r.body as { error?: { code?: string } };
      expect(body.error?.code).toBe('NOT_FOUND');
    });
  });

  /* ================================================================ */
  /*  3. BOARDING API                                                  */
  /* ================================================================ */

  describe('Boarding API', () => {
    it('GET /api/agency/boarding/:qrCode — A lookup on own trip = 200', async () => {
      if (skipIfUnavailable()) return;
      // QR code for reservation A is 'QR-TI-A1' (from seed)
      const r = await req(f.baseUrl, 'GET', '/api/agency/boarding/QR-TI-A1', f.tokenA);
      expect(r.status).toBe(200);
      const body = r.body as any;
      // Lookup always returns 200 with envelope
      expect(body.found).toBe(true);
      expect(body.allowed).toBe(true);
      expect(body.result).toBeDefined();
    });

    it('GET /api/agency/boarding/:qrCode — A lookup on B trip = 200 with denial envelope', async () => {
      if (skipIfUnavailable()) return;
      // QR code for reservation B is 'QR-TI-B1' — agency A should not see it
      const r = await req(f.baseUrl, 'GET', '/api/agency/boarding/QR-TI-B1', f.tokenA);
      // lookupPassengerByQR always returns 200; denial is in the envelope
      expect(r.status).toBe(200);
      const body = r.body as any;
      expect(body.found).toBe(true);
      expect(body.allowed).toBe(false);
      expect(body.failure_code).toBe('AGENCY_NOT_ASSIGNED');
    });

    it('PATCH /api/agency/boarding/:passengerId — A toggle on unassigned trip = 403', async () => {
      if (skipIfUnavailable()) return;
      // PAS_B belongs to B's trip which A is not assigned to
      const r = await req(f.baseUrl, 'PATCH', `/api/agency/boarding/${IDS.PAS_B}`, f.tokenA, {
        boarded: true,
      });
      // RPC returns "no está asignada" → ForbiddenError → 403
      expect(r.status).toBe(403);
      const body = r.body as { error?: { code?: string } };
      expect(body.error?.code).toBe('FORBIDDEN');
    });

    it('PATCH /api/agency/boarding/:passengerId — A toggle on own assigned trip = 200', async () => {
      if (skipIfUnavailable()) return;
      // Create a temp reservation on A's trip for this test
      const pg = await import('pg');
      const client = new pg.default.Client({
        connectionString: process.env.TENANT_DB_URL || process.env.DATABASE_URL ||
          'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      });
      await client.connect();
      try {
        const seatResult = await client.query(
          `INSERT INTO public.seats (trip_id, seat_code, status) VALUES ($1, 'BOARD-1', 'available') RETURNING id`,
          [IDS.TRIP_A],
        );
        const seatId = seatResult.rows[0].id;

        const rpcResult = await client.query(
          `SELECT public.create_agency_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            IDS.TRIP_A, IDS.AGENCY_A, IDS.USER_A,
            'Board Booker', '11111111', '555-BOARD',
            [seatId], ['Board Passenger'], ['11111111'], ['555-BOARD'],
          ],
        );
        const resId = rpcResult.rows[0]?.create_agency_reservation?.reservation_id
          ?? rpcResult.rows[0]?.reservation_id
          ?? rpcResult.rows[0]?.id;

        // Get the passenger ID from the reservation
        const pasResult = await client.query(
          `SELECT id FROM public.reservation_passengers WHERE reservation_id = $1 LIMIT 1`,
          [resId],
        );
        const passengerId = pasResult.rows[0]?.id;
        expect(passengerId).toBeDefined();

        // Toggle boarding via HTTP — full chain: JWT → auth → authorize → tenant → controller → service → RPC → DB
        const r = await req(f.baseUrl, 'PATCH', `/api/agency/boarding/${passengerId}`, f.tokenA, {
          boarded: true,
        });
        expect(r.status).toBe(200);
        const body = r.body as any;
        expect(body.passenger_id).toBe(passengerId);
        expect(body.boarded).toBe(true);
        expect(body.changed).toBe(true);
      } finally {
        await client.query(
          'DELETE FROM public.reservation_passengers WHERE reservation_id IN (SELECT id FROM public.reservations WHERE agency_id = $1 AND booker_name = $2)',
          [IDS.AGENCY_A, 'Board Booker'],
        );
        await client.query(
          'DELETE FROM public.reservations WHERE agency_id = $1 AND booker_name = $2',
          [IDS.AGENCY_A, 'Board Booker'],
        );
        await client.query('DELETE FROM public.seats WHERE trip_id = $1 AND seat_code = $2', [IDS.TRIP_A, 'BOARD-1']);
        await client.end();
      }
    });
  });

  /* ================================================================ */
  /*  4. AUDIT API                                                     */
  /* ================================================================ */

  describe('Audit API', () => {
    it('GET /api/agency/audit — A reads own = 200 with A data only', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', '/api/agency/audit', f.tokenA);
      expect(r.status).toBe(200);
      const body = r.body as any;
      // Verify it's a paginated response with events array
      expect(body).toBeDefined();
      // All events should belong to agency A
      if (body.events && Array.isArray(body.events)) {
        for (const event of body.events) {
          expect(event.agency_id).toBe(IDS.AGENCY_A);
        }
      }
    });

    it('GET /api/agency/audit — agency_id param is rejected (FORBIDDEN)', async () => {
      if (skipIfUnavailable()) return;
      // The agency audit endpoint rejects agency_id as a query parameter
      const r = await req(f.baseUrl, 'GET', `/api/agency/audit?agency_id=${IDS.AGENCY_B}`, f.tokenA);
      expect(r.status).toBe(400);
      const body = r.body as { error?: { code?: string } };
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  /* ================================================================ */
  /*  5. RESERVATION LINKS API                                         */
  /* ================================================================ */

  describe('Reservation Links API', () => {
    it('GET /api/agency/reservations/links — A reads own = 200', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', '/api/agency/reservations/links', f.tokenA);
      expect(r.status).toBe(200);
      const body = r.body as any;
      // Should return array or paginated object
      expect(body).toBeDefined();
    });

    it('GET /api/agency/reservations/links/:id — A reads B link = 404', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', `/api/agency/reservations/links/${IDS.LINK_B}`, f.tokenA);
      expect(r.status).toBe(404);
    });

    it('POST /api/agency/reservations/links — A creates on own trip = 201 or 409', async () => {
      if (skipIfUnavailable()) return;
      // Seat A1 is already in a link from seed, so creating another may conflict.
      // Test that the endpoint processes the request correctly (not a permission error).
      const r = await req(f.baseUrl, 'POST', '/api/agency/reservations/links', f.tokenA, {
        trip_id: IDS.TRIP_A,
        seat_ids: [IDS.SEAT_A1],
      });
      // 201 = success, 409 = seat already has active link — both prove agency access works
      expect([201, 409]).toContain(r.status);
    });

    it('POST /api/agency/reservations/links — A creates on B-only trip = 403', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'POST', '/api/agency/reservations/links', f.tokenA, {
        trip_id: IDS.TRIP_B,
        seat_ids: [IDS.SEAT_B1],
      });
      expect(r.status).toBe(403);
      const body = r.body as { error?: { code?: string } };
      expect(body.error?.code).toBe('FORBIDDEN');
    });

    it('POST /api/agency/reservations/links/:id/confirm — A confirms B link = 404', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'POST', `/api/agency/reservations/links/${IDS.LINK_B}/confirm`, f.tokenA);
      expect(r.status).toBe(404);
    });

    it('POST /api/agency/reservations/links/:id/cancel — A cancels B link = 404', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'POST', `/api/agency/reservations/links/${IDS.LINK_B}/cancel`, f.tokenA);
      expect(r.status).toBe(404);
    });

    it('POST /api/agency/reservations/links/:id/invalidate — A invalidates B link = 404', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'POST', `/api/agency/reservations/links/${IDS.LINK_B}/invalidate`, f.tokenA);
      expect(r.status).toBe(404);
    });

    it('POST /api/agency/reservations/links/:id/regenerate — A regenerates B link = 404', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'POST', `/api/agency/reservations/links/${IDS.LINK_B}/regenerate`, f.tokenA);
      expect(r.status).toBe(404);
    });

    it('PATCH /api/agency/reservations/links/:id/data — A patches B link = 404', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'PATCH', `/api/agency/reservations/links/${IDS.LINK_B}/data`, f.tokenA, {
        link_data: {
          booker_name: 'Forged Booker',
          passengers: [{ seat_code: 'A1', name: 'Forged', document: '11111111' }],
        },
      });
      expect(r.status).toBe(404);
    });
  });

  /* ================================================================ */
  /*  6. AGENCY / ID FORGERY                                           */
  /* ================================================================ */

  describe('Agency/ID Forgery', () => {
    it('GET /api/agency/reservations/:id — JWT A, forged B reservation ID = 404', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', `/api/agency/reservations/${IDS.RES_B}`, f.tokenA);
      expect(r.status).toBe(404);
      // Verify the response body does NOT contain B's data
      const body = r.body as any;
      if (body.reservation_id) {
        expect(body.reservation_id).not.toBe(IDS.RES_B);
      }
    });

    it('PATCH /api/agency/reservations/:id/cancel — JWT A, forged B reservation ID = 404', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'PATCH', `/api/agency/reservations/${IDS.RES_B}/cancel`, f.tokenA);
      expect(r.status).toBe(404);
    });

    it('GET /api/agency/reservations/links/:id — JWT A, forged B link ID = 404', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', `/api/agency/reservations/links/${IDS.LINK_B}`, f.tokenA);
      expect(r.status).toBe(404);
    });

    it('POST /api/agency/reservations — JWT A, forged trip_id for B = 403', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'POST', '/api/agency/reservations', f.tokenA, {
        trip_id: IDS.TRIP_B,
        booker_name: 'Forgery Attempt',
        booker_document: '12345678',
        passengers: [{
          seat_id: IDS.SEAT_B1,
          name: 'Forgery Passenger',
          document: '12345678',
        }],
      });
      expect(r.status).toBe(403);
      const body = r.body as { error?: { code?: string } };
      expect(body.error?.code).toBe('FORBIDDEN');
    });

    it('POST /api/agency/reservations/links — JWT A, forged trip_id for B = 403', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'POST', '/api/agency/reservations/links', f.tokenA, {
        trip_id: IDS.TRIP_B,
        seat_ids: [IDS.SEAT_B1],
      });
      expect(r.status).toBe(403);
      const body = r.body as { error?: { code?: string } };
      expect(body.error?.code).toBe('FORBIDDEN');
    });

    it('PATCH /api/agency/boarding/:passengerId — JWT A, forged B passenger = denied', async () => {
      if (skipIfUnavailable()) return;
      // PAS_B belongs to B's trip; A should not be able to toggle boarding
      const r = await req(f.baseUrl, 'PATCH', `/api/agency/boarding/${IDS.PAS_B}`, f.tokenA, {
        boarded: true,
      });
      // RPC returns "no está asignada" → ForbiddenError → 403
      expect(r.status).toBe(403);
      const body = r.body as { error?: { code?: string } };
      expect(body.error?.code).toBe('FORBIDDEN');
    });

    it('B cannot access A reservations (reverse direction)', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', `/api/agency/reservations/${IDS.RES_A}`, f.tokenB);
      expect(r.status).toBe(404);
    });

    it('B cannot cancel A reservation (reverse direction)', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'PATCH', `/api/agency/reservations/${IDS.RES_A}/cancel`, f.tokenB);
      expect(r.status).toBe(404);
    });

    it('B cannot access A link (reverse direction)', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', `/api/agency/reservations/links/${IDS.LINK_A}`, f.tokenB);
      expect(r.status).toBe(404);
    });

    it('B cannot create reservation on A-only trip (reverse direction)', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'POST', '/api/agency/reservations', f.tokenB, {
        trip_id: IDS.TRIP_A,
        booker_name: 'Reverse Forgery',
        booker_document: '12345678',
        passengers: [{
          seat_id: IDS.SEAT_A1,
          name: 'Reverse Passenger',
          document: '12345678',
        }],
      });
      expect(r.status).toBe(403);
      const body = r.body as { error?: { code?: string } };
      expect(body.error?.code).toBe('FORBIDDEN');
    });
  });

  /* ================================================================ */
  /*  7. ERROR CONTRACTS VERIFICATION                                   */
  /* ================================================================ */

  describe('Error contracts', () => {
    it('401 includes UNAUTHORIZED code', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', '/api/agency/reservations');
      expect(r.status).toBe(401);
      const body = r.body as { error?: { code?: string; message?: string } };
      expect(body.error?.code).toBe('UNAUTHORIZED');
      expect(body.error?.message).toBeDefined();
    });

    it('403 includes FORBIDDEN code', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'POST', '/api/agency/reservations', f.tokenA, {
        trip_id: IDS.TRIP_B,
        booker_name: 'Error Contract',
        booker_document: '12345678',
        passengers: [{
          seat_id: IDS.SEAT_B1,
          name: 'Error Passenger',
          document: '12345678',
        }],
      });
      expect(r.status).toBe(403);
      const body = r.body as { error?: { code?: string; message?: string } };
      expect(body.error?.code).toBe('FORBIDDEN');
      expect(body.error?.message).toBeDefined();
    });

    it('404 includes NOT_FOUND code', async () => {
      if (skipIfUnavailable()) return;
      const r = await req(f.baseUrl, 'GET', `/api/agency/reservations/${IDS.RES_B}`, f.tokenA);
      expect(r.status).toBe(404);
      const body = r.body as { error?: { code?: string; message?: string } };
      expect(body.error?.code).toBe('NOT_FOUND');
      expect(body.error?.message).toBeDefined();
    });
  });
});
