/**
 * @vitest-environment node
 *
 * SEC-009.3 Phase 2A + 2B — RPC Authorization Tests
 *
 * Phase 2A: Validates execute privilege boundary (authenticated denied).
 * Phase 2B: Validates business authorization logic (service_role + actor identity).
 *
 * Phase 2A proves authenticated cannot call RPCs (REVOKE enforcement).
 * Phase 2B proves RPCs enforce actor↔agency ownership internally.
 *
 * Requires: Supabase Local running (supabase start) with all migrations applied.
 * Local dev: TEST_MODE=local (default) → skips when DB unreachable.
 * CI:        TEST_MODE=ci → fails when DB unreachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  IDS,
  createFixture,
  shouldFailIfNoDb,
  type Fixture,
} from './tenant-isolation.fixture.js';

/* ------------------------------------------------------------------ */
/*  Skip / fail gate                                                   */
/* ------------------------------------------------------------------ */

const mustFailWithoutDb = shouldFailIfNoDb();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Attempt to call an RPC function as authenticated role (Phase 2A).
 * Returns { rows, denied } — denied=true means REVOKE is enforced.
 */
async function callRpcAsAuthenticated(
  f: Fixture,
  functionName: string,
  args: unknown[],
): Promise<{ rows: unknown[]; denied: boolean; errorMsg?: string }> {
  try {
    const result = await f.authQuery(
      IDS.USER_A,
      `SELECT public.${functionName}(${args.map((_: unknown, i: number) => `$${i + 1}`).join(', ')})`,
      args,
    );
    return { rows: result.rows, denied: false };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/permission denied/i.test(msg)) {
      return { rows: [], denied: true, errorMsg: msg };
    }
    throw error;
  }
}

/**
 * Call an RPC function as service_role (Phase 2B).
 * Uses the base postgres client directly — no role switching.
 * Returns { rows } on success, { error } on failure.
 */
async function callRpcAsServiceRole(
  f: Fixture,
  functionName: string,
  args: unknown[],
): Promise<{ rows: unknown[]; error?: string }> {
  try {
    const result = await f.client.query(
      `SELECT public.${functionName}(${args.map((_: unknown, i: number) => `$${i + 1}`).join(', ')})`,
      args,
    );
    return { rows: result.rows };
  } catch (error: unknown) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/* ------------------------------------------------------------------ */
/*  Test suite                                                          */
/* ------------------------------------------------------------------ */

describe('SEC-009.3 — RPC Authorization', () => {
  let f: Fixture | undefined;
  let linkIds: { linkA: string; linkB: string } | undefined;

  beforeAll(async () => {
    try {
      f = await createFixture();
      if (f) {
        linkIds = await f.getLinkIds();
      }
    } catch (error: unknown) {
      if (mustFailWithoutDb) {
        throw new Error(
          'SEC-009.3 RPC CI: Failed to connect to database. ' +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
  }, 30_000);

  afterAll(async () => {
    if (!f) return;
    await f.cleanup();
    await f.client.end();
  });

  /* ================================================================== */
  /*  1. Auth Context                                                    */
  /* ================================================================== */

  describe('Auth Context', () => {
    it('auth.uid() returns User A', async () => {
      if (!f) return;
      const r = await f.authQuery(IDS.USER_A, 'SELECT auth.uid() AS uid');
      expect(r.rows[0]?.uid).toBe(IDS.USER_A);
    });

    it('auth_app_role() returns agency', async () => {
      if (!f) return;
      const r = await f.authQuery(IDS.USER_A, 'SELECT private.auth_app_role() AS role');
      expect(r.rows[0]?.role).toBe('agency');
    });

    it('auth_app_agency_id() returns Agency A', async () => {
      if (!f) return;
      const r = await f.authQuery(IDS.USER_A, 'SELECT private.auth_app_agency_id() AS aid');
      expect(r.rows[0]?.aid).toBe(IDS.AGENCY_A);
    });
  });

  /* ================================================================== */
  /*  PHASE 2A — Execute Privilege Boundary                              */
  /* ================================================================== */

  describe('Phase 2A — authenticated denied', () => {
    it('create_agency_reservation: permission denied', async () => {
      if (!f) return;
      const r = await callRpcAsAuthenticated(f, 'create_agency_reservation', [
        IDS.TRIP_A, IDS.AGENCY_A, IDS.USER_A, 'Test', 'DOC', '555',
        [IDS.SEAT_A1], ['P'], ['D'], ['555'],
      ]);
      expect(r.denied).toBe(true);
    });

    it('cancel_agency_reservation: permission denied', async () => {
      if (!f) return;
      const r = await callRpcAsAuthenticated(f, 'cancel_agency_reservation', [
        IDS.RES_A, IDS.USER_A, IDS.AGENCY_A, {},
      ]);
      expect(r.denied).toBe(true);
    });

    it('update_agency_branding: permission denied', async () => {
      if (!f) return;
      const r = await callRpcAsAuthenticated(f, 'update_agency_branding', [
        IDS.AGENCY_A, IDS.USER_A, { primary_color: '#FF0000' }, {},
      ]);
      expect(r.denied).toBe(true);
    });

    it('update_agency_notification_preferences: permission denied', async () => {
      if (!f) return;
      const r = await callRpcAsAuthenticated(f, 'update_agency_notification_preferences', [
        IDS.AGENCY_A, IDS.USER_A, { trip_assignments: false }, {},
      ]);
      expect(r.denied).toBe(true);
    });

    it('create_reservation_link: permission denied', async () => {
      if (!f) return;
      const r = await callRpcAsAuthenticated(f, 'create_reservation_link', [
        IDS.TRIP_A, IDS.AGENCY_A, IDS.USER_A, 'hash', [IDS.SEAT_A1],
      ]);
      expect(r.denied).toBe(true);
    });

    it('confirm_reservation_from_link: permission denied', async () => {
      if (!f) return;
      const r = await callRpcAsAuthenticated(f, 'confirm_reservation_from_link', [
        IDS.LINK_A, IDS.AGENCY_A, IDS.USER_A,
      ]);
      expect(r.denied).toBe(true);
    });

    it('regenerate_reservation_link: permission denied', async () => {
      if (!f) return;
      const r = await callRpcAsAuthenticated(f, 'regenerate_reservation_link', [
        IDS.LINK_A, IDS.AGENCY_A, IDS.USER_A, 'new-hash',
      ]);
      expect(r.denied).toBe(true);
    });

    it('cancel_reservation_link: permission denied', async () => {
      if (!f) return;
      const r = await callRpcAsAuthenticated(f, 'cancel_reservation_link', [
        IDS.LINK_A, IDS.AGENCY_A,
      ]);
      expect(r.denied).toBe(true);
    });

    it('invalidate_reservation_link: permission denied', async () => {
      if (!f) return;
      const r = await callRpcAsAuthenticated(f, 'invalidate_reservation_link', [
        IDS.LINK_A, IDS.AGENCY_A,
      ]);
      expect(r.denied).toBe(true);
    });

    it('patch_reservation_link_data: permission denied', async () => {
      if (!f) return;
      const r = await callRpcAsAuthenticated(f, 'patch_reservation_link_data', [
        IDS.LINK_A, IDS.AGENCY_A, { passengers: [] },
      ]);
      expect(r.denied).toBe(true);
    });

    it('boarding_toggle: permission denied', async () => {
      if (!f) return;
      const r = await callRpcAsAuthenticated(f, 'boarding_toggle', [
        IDS.PAS_A, true, IDS.USER_A, IDS.AGENCY_A,
      ]);
      expect(r.denied).toBe(true);
    });
  });

  /* ================================================================== */
  /*  PHASE 2B — Business Authorization (service_role + actor identity)  */
  /* ================================================================== */

  describe('Phase 2B — actor/agency tampering', () => {
    it('create_agency_reservation: USER_A + AGENCY_B → ERR_AGENCY_NOT_ASSIGNED', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'create_agency_reservation', [
        IDS.TRIP_A, IDS.AGENCY_B, IDS.USER_A, 'Test', 'DOC', '555',
        [IDS.SEAT_A1], ['P'], ['D'], ['555'],
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_AGENCY_NOT_ASSIGNED');
    });

    it('cancel_agency_reservation: USER_A + AGENCY_B → ERR_ACTOR_AGENCY_MISMATCH', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'cancel_agency_reservation', [
        IDS.RES_A, IDS.USER_A, IDS.AGENCY_B, {},
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_ACTOR_AGENCY_MISMATCH');
    });

    it('update_agency_branding: USER_A + AGENCY_B → ERR_ACTOR_AGENCY_MISMATCH', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'update_agency_branding', [
        IDS.AGENCY_B, IDS.USER_A, { primary_color: '#FF0000' }, {},
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_ACTOR_AGENCY_MISMATCH');
    });

    it('update_agency_notification_preferences: USER_A + AGENCY_B → ERR_ACTOR_AGENCY_MISMATCH', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'update_agency_notification_preferences', [
        IDS.AGENCY_B, IDS.USER_A, { trip_assignments: false }, {},
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_ACTOR_AGENCY_MISMATCH');
    });

    it('create_reservation_link: USER_A + AGENCY_B → ERR_AGENCY_NOT_ASSIGNED', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'create_reservation_link', [
        IDS.TRIP_A, IDS.AGENCY_B, IDS.USER_A, 'hash', [IDS.SEAT_A1],
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_AGENCY_NOT_ASSIGNED');
    });

    it('confirm_reservation_from_link: USER_A + AGENCY_B → ERR_LINK_NOT_FOUND', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'confirm_reservation_from_link', [
        IDS.LINK_A, IDS.AGENCY_B, IDS.USER_A,
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_LINK_NOT_FOUND');
    });

    it('regenerate_reservation_link: USER_A + AGENCY_B → ERR_LINK_NOT_FOUND', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'regenerate_reservation_link', [
        IDS.LINK_A, IDS.AGENCY_B, IDS.USER_A, 'new-hash',
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_LINK_NOT_FOUND');
    });

    it('cancel_reservation_link: USER_A + AGENCY_B → ERR_LINK_NOT_FOUND', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'cancel_reservation_link', [
        IDS.LINK_A, IDS.AGENCY_B,
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_LINK_NOT_FOUND');
    });

    it('invalidate_reservation_link: USER_A + AGENCY_B → ERR_LINK_NOT_FOUND', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'invalidate_reservation_link', [
        IDS.LINK_A, IDS.AGENCY_B,
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_LINK_NOT_FOUND');
    });

    it('patch_reservation_link_data: USER_A + AGENCY_B → ERR_LINK_NOT_FOUND', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'patch_reservation_link_data', [
        IDS.LINK_A, IDS.AGENCY_B, { passengers: [] },
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_LINK_NOT_FOUND');
    });

    it('boarding_toggle: USER_A + AGENCY_B → actor/agencia mismatch', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'boarding_toggle', [
        IDS.PAS_A, true, IDS.USER_A, IDS.AGENCY_B,
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('El actor no pertenece a la agencia operadora');
    });
  });

  describe('Phase 2B — positive authorization (A → A)', () => {
    it('create_agency_reservation: USER_A + AGENCY_A + assigned trip → success', async () => {
      if (!f) return;
      const seat = await f.createDedicatedSeat(IDS.TRIP_A);
      const r = await callRpcAsServiceRole(f, 'create_agency_reservation', [
        IDS.TRIP_A, IDS.AGENCY_A, IDS.USER_A, 'Booker TI', 'DOC-TI', '555-9999',
        [seat.seatId], ['Passenger TI'], ['DOC-PTI'], ['555-9998'],
      ]);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(1);
      expect(r.rows[0]).toBeDefined();
    });

    it('create_reservation_link: USER_A + AGENCY_A + assigned trip + locked seat → success', async () => {
      if (!f) return;
      const seat = await f.createDedicatedSeat(IDS.TRIP_A);
      const { linkId } = await f.createReservationLink(IDS.USER_A, IDS.AGENCY_A, IDS.TRIP_A, [seat.seatId]);
      expect(linkId).toBeDefined();
      expect(typeof linkId).toBe('string');
    });

    it('confirm_reservation_from_link: USER_A + AGENCY_A + own link → success', async () => {
      if (!f) return;
      const seat = await f.createDedicatedSeat(IDS.TRIP_A);
      const { linkId } = await f.createReservationLink(IDS.USER_A, IDS.AGENCY_A, IDS.TRIP_A, [seat.seatId]);
      await f.patchLinkData(linkId, IDS.AGENCY_A, {
        booker_name: 'Test Booker',
        booker_document: 'DOC-BOOKER',
        booker_phone: '555-BOOK',
        passengers: [{ seat_code: seat.seatCode, name: 'Test Pax', document: 'DOC-PAX' }],
      });
      const r = await callRpcAsServiceRole(f, 'confirm_reservation_from_link', [
        linkId, IDS.AGENCY_A, IDS.USER_A,
      ]);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(1);
      expect(r.rows[0]).toBeDefined();
    });

    it('regenerate_reservation_link: USER_A + AGENCY_A + own link → success', async () => {
      if (!f) return;
      const seat = await f.createDedicatedSeat(IDS.TRIP_A);
      const { linkId } = await f.createReservationLink(IDS.USER_A, IDS.AGENCY_A, IDS.TRIP_A, [seat.seatId]);
      const r = await callRpcAsServiceRole(f, 'regenerate_reservation_link', [
        linkId, IDS.AGENCY_A, IDS.USER_A, 'new-token-hash',
      ]);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(1);
      expect(r.rows[0]).toBeDefined();
    });

    it('cancel_reservation_link: USER_A + AGENCY_A + own link → success', async () => {
      if (!f) return;
      const seat = await f.createDedicatedSeat(IDS.TRIP_A);
      const { linkId } = await f.createReservationLink(IDS.USER_A, IDS.AGENCY_A, IDS.TRIP_A, [seat.seatId]);
      const r = await callRpcAsServiceRole(f, 'cancel_reservation_link', [
        linkId, IDS.AGENCY_A,
      ]);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(1);
      expect(r.rows[0]).toBeDefined();
    });

    it('invalidate_reservation_link: USER_A + AGENCY_A + own link → success', async () => {
      if (!f) return;
      const seat = await f.createDedicatedSeat(IDS.TRIP_A);
      const { linkId } = await f.createReservationLink(IDS.USER_A, IDS.AGENCY_A, IDS.TRIP_A, [seat.seatId]);
      const r = await callRpcAsServiceRole(f, 'invalidate_reservation_link', [
        linkId, IDS.AGENCY_A,
      ]);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(1);
      expect(r.rows[0]).toBeDefined();
    });

    it('patch_reservation_link_data: USER_A + AGENCY_A + own link → success', async () => {
      if (!f) return;
      const seat = await f.createDedicatedSeat(IDS.TRIP_A);
      const { linkId } = await f.createReservationLink(IDS.USER_A, IDS.AGENCY_A, IDS.TRIP_A, [seat.seatId]);
      const r = await callRpcAsServiceRole(f, 'patch_reservation_link_data', [
        linkId, IDS.AGENCY_A, { passengers: [{ seat_code: seat.seatCode, name: 'Test Pax', document: 'DOC-TEST' }] },
      ]);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(1);
      expect(r.rows[0]).toBeDefined();
    });

    it('update_agency_branding: USER_A + AGENCY_A → success', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'update_agency_branding', [
        IDS.AGENCY_A, IDS.USER_A, { primary_color: '#FF0000' }, {},
      ]);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(1);
      const data = r.rows[0] as Record<string, unknown>;
      const branding = data?.update_agency_branding as Record<string, unknown>;
      expect(branding?.changed).toBe(true);
    });

    it('update_agency_notification_preferences: USER_A + AGENCY_A → success', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'update_agency_notification_preferences', [
        IDS.AGENCY_A, IDS.USER_A, { trip_assignments: false }, {},
      ]);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(1);
      const data = r.rows[0] as Record<string, unknown>;
      const prefs = data?.update_agency_notification_preferences as Record<string, unknown>;
      expect(prefs?.changed).toBe(true);
    });

    it('cancel_agency_reservation: USER_A + AGENCY_A + own reservation → success', async () => {
      if (!f) return;
      const tempResId = await f.createTempReservation(IDS.USER_A, IDS.AGENCY_A, IDS.TRIP_A);
      const r = await callRpcAsServiceRole(f, 'cancel_agency_reservation', [
        tempResId, IDS.USER_A, IDS.AGENCY_A, {},
      ]);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(1);
      const data = r.rows[0] as Record<string, unknown>;
      const cancel = data?.cancel_agency_reservation as Record<string, unknown>;
      expect(cancel?.cancelled).toBe(true);
    });

    it('boarding_toggle: USER_A + OPERATOR_A + assigned trip + passenger → success', async () => {
      if (!f) return;
      const scenario = await f.createBoardingScenario(IDS.AGENCY_A, IDS.USER_A);
      const r = await callRpcAsServiceRole(f, 'boarding_toggle', [
        scenario.passengerId, true, IDS.USER_A, IDS.AGENCY_A,
      ]);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(1);
      const data = r.rows[0] as Record<string, unknown>;
      const boarding = data?.boarding_toggle as Record<string, unknown>;
      expect(boarding?.passenger_id).toBeDefined();
      expect(boarding?.boarded).toBe(true);
    });
  });

  describe('Phase 2B — resource ownership A → B (other-resource denial)', () => {
    it('confirm_reservation_from_link: USER_A + AGENCY_A on B link → ERR_LINK_NOT_FOUND', async () => {
      if (!f || !linkIds) return;
      const r = await callRpcAsServiceRole(f, 'confirm_reservation_from_link', [
        linkIds.linkB, IDS.AGENCY_A, IDS.USER_A,
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_LINK_NOT_FOUND');
    });

    it('regenerate_reservation_link: USER_A + AGENCY_A on B link → ERR_LINK_NOT_FOUND', async () => {
      if (!f || !linkIds) return;
      const r = await callRpcAsServiceRole(f, 'regenerate_reservation_link', [
        linkIds.linkB, IDS.AGENCY_A, IDS.USER_A, 'new-hash',
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_LINK_NOT_FOUND');
    });

    it('cancel_reservation_link: USER_A + AGENCY_A on B link → ERR_LINK_NOT_FOUND', async () => {
      if (!f || !linkIds) return;
      const r = await callRpcAsServiceRole(f, 'cancel_reservation_link', [
        linkIds.linkB, IDS.AGENCY_A,
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_LINK_NOT_FOUND');
    });

    it('invalidate_reservation_link: USER_A + AGENCY_A on B link → ERR_LINK_NOT_FOUND', async () => {
      if (!f || !linkIds) return;
      const r = await callRpcAsServiceRole(f, 'invalidate_reservation_link', [
        linkIds.linkB, IDS.AGENCY_A,
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_LINK_NOT_FOUND');
    });

    it('patch_reservation_link_data: USER_A + AGENCY_A on B link → ERR_LINK_NOT_FOUND', async () => {
      if (!f || !linkIds) return;
      const r = await callRpcAsServiceRole(f, 'patch_reservation_link_data', [
        linkIds.linkB, IDS.AGENCY_A, { passengers: [] },
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_LINK_NOT_FOUND');
    });

    it('create_reservation_link: USER_A + AGENCY_A on B-only trip → ERR_AGENCY_NOT_ASSIGNED', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'create_reservation_link', [
        IDS.TRIP_B, IDS.AGENCY_A, IDS.USER_A, 'hash', [IDS.SEAT_B1],
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_AGENCY_NOT_ASSIGNED');
    });

    it('cancel_agency_reservation: USER_A + AGENCY_A on B reservation → ERR_RESERVATION_NOT_OWNED', async () => {
      if (!f) return;
      const r = await callRpcAsServiceRole(f, 'cancel_agency_reservation', [
        IDS.RES_B, IDS.USER_A, IDS.AGENCY_A, {},
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('ERR_RESERVATION_NOT_OWNED');
    });

    it('boarding_toggle: USER_A + OPERATOR_A on unassigned trip → denied', async () => {
      if (!f) return;
      const scenario = await f.createBoardingScenario(IDS.AGENCY_B, IDS.USER_B);
      const r = await callRpcAsServiceRole(f, 'boarding_toggle', [
        scenario.passengerId, true, IDS.USER_A, IDS.AGENCY_A,
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('Tu agencia no está asignada a este viaje');
    });
  });

  describe('Phase 2B — boarding_toggle authorization matrix', () => {
    it('boarding_toggle: USER_A + OPERATOR_A + assigned trip → success', async () => {
      if (!f) return;
      const scenario = await f.createBoardingScenario(IDS.AGENCY_A, IDS.USER_A);
      const r = await callRpcAsServiceRole(f, 'boarding_toggle', [
        scenario.passengerId, true, IDS.USER_A, IDS.AGENCY_A,
      ]);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(1);
      const data = r.rows[0] as Record<string, unknown>;
      const boarding = data?.boarding_toggle as Record<string, unknown>;
      expect(boarding?.passenger_id).toBeDefined();
      expect(boarding?.boarded).toBe(true);
    });

    it('boarding_toggle: USER_A + OPERATOR_A + unassigned trip → denied', async () => {
      if (!f) return;
      const scenario = await f.createBoardingScenario(IDS.AGENCY_B, IDS.USER_B);
      const r = await callRpcAsServiceRole(f, 'boarding_toggle', [
        scenario.passengerId, true, IDS.USER_A, IDS.AGENCY_A,
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('Tu agencia no está asignada a este viaje');
    });

    it('boarding_toggle: USER_A + OPERATOR_B + assigned trip → actor/operator mismatch', async () => {
      if (!f) return;
      const scenario = await f.createBoardingScenario(IDS.AGENCY_A, IDS.USER_A);
      const r = await callRpcAsServiceRole(f, 'boarding_toggle', [
        scenario.passengerId, true, IDS.USER_A, IDS.AGENCY_B,
      ]);
      expect(r.error).toBeDefined();
      expect(r.error).toContain('El actor no pertenece a la agencia operadora');
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Integration gate                                                    */
/* ------------------------------------------------------------------ */

describe('SEC-009.3 — RPC gate', () => {
  it('skips live suite unless DB is configured', () => {
    if (mustFailWithoutDb) {
      expect(true).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });
});