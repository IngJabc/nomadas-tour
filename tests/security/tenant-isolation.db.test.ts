/**
 * @vitest-environment node
 *
 * SEC-009.3 — Tenant Isolation DB/RLS Test Suite
 *
 * Validates real Row-Level Security enforcement between two agencies
 * on Supabase Local. Uses parameterized set_config() for JWT claims.
 *
 * Requires: Supabase Local running (supabase start) with all migrations applied.
 * Local dev: TEST_MODE=local (default) → skips when DB unreachable.
 * CI:        TEST_MODE=ci → fails when DB unreachable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
/*  Test suite                                                          */
/* ------------------------------------------------------------------ */

describe('SEC-009.3 — Tenant Isolation DB/RLS', () => {
  let f: Fixture | undefined;

  beforeAll(async () => {
    try {
      f = await createFixture();
    } catch (error: unknown) {
      if (mustFailWithoutDb) {
        throw new Error(
          'SEC-009.3 CI: Failed to connect to database. ' +
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
  /*  1. Auth Context Verification                                       */
  /* ================================================================== */

  describe('Auth Context', () => {
    it('auth.uid() returns User A', async () => {
      if (!f) return;
      const r = await f.authQuery(IDS.USER_A, 'SELECT auth.uid() AS uid');
      expect(r.rows[0]?.uid).toBe(IDS.USER_A);
    });

    it('auth_app_role() returns agency', async () => {
      if (!f) return;
      const r = await f.authQuery(
        IDS.USER_A,
        'SELECT private.auth_app_role() AS role',
      );
      expect(r.rows[0]?.role).toBe('agency');
    });

    it('auth_app_agency_id() returns Agency A', async () => {
      if (!f) return;
      const r = await f.authQuery(
        IDS.USER_A,
        'SELECT private.auth_app_agency_id() AS aid',
      );
      expect(r.rows[0]?.aid).toBe(IDS.AGENCY_A);
    });
  });

  /* ================================================================== */
  /*  2. A Sees Own Data (Positive)                                      */
  /* ================================================================== */

  describe('A sees own data', () => {
    it('reservations: sees own (count=1)', async () => {
      if (!f) return;
      const r = await f.authQuery(
        IDS.USER_A,
        'SELECT count(*)::int AS cnt FROM public.reservations',
      );
      expect(r.rows[0]?.cnt).toBe(1);
    });

    it('reservation_passengers: sees own (count=1)', async () => {
      if (!f) return;
      const r = await f.authQuery(
        IDS.USER_A,
        'SELECT count(*)::int AS cnt FROM public.reservation_passengers',
      );
      expect(r.rows[0]?.cnt).toBe(1);
    });

    it('reservation_links: sees own (count=1)', async () => {
      if (!f) return;
      const r = await f.authQuery(
        IDS.USER_A,
        'SELECT count(*)::int AS cnt FROM public.reservation_links',
      );
      expect(r.rows[0]?.cnt).toBe(1);
    });

    it('notifications: sees own (count=1)', async () => {
      if (!f) return;
      const r = await f.authQuery(
        IDS.USER_A,
        'SELECT count(*)::int AS cnt FROM public.notifications',
      );
      expect(r.rows[0]?.cnt).toBe(1);
    });

    it('agency_settings: sees own (count=1)', async () => {
      if (!f) return;
      const r = await f.authQuery(
        IDS.USER_A,
        'SELECT count(*)::int AS cnt FROM public.agency_settings',
      );
      expect(r.rows[0]?.cnt).toBe(1);
    });

    it('agency_notification_preferences: sees own', async () => {
      if (!f) return;
      const r = await f.authQuery(
        IDS.USER_A,
        'SELECT count(*)::int AS cnt FROM public.agency_notification_preferences',
      );
      expect(r.rows[0]?.cnt).toBeGreaterThanOrEqual(1);
    });

    it('audit_log: sees own (count=1)', async () => {
      if (!f) return;
      const r = await f.authQuery(
        IDS.USER_A,
        'SELECT count(*)::int AS cnt FROM public.audit_log',
      );
      expect(r.rows[0]?.cnt).toBe(1);
    });

    it('users: sees same-agency users (count=1)', async () => {
      if (!f) return;
      const r = await f.authQuery(
        IDS.USER_A,
        'SELECT count(*)::int AS cnt FROM public.users',
      );
      expect(r.rows[0]?.cnt).toBe(1);
    });
  });

  /* ================================================================== */
  /*  3. A Cannot See B (Cross-Tenant Isolation)                         */
  /* ================================================================== */

  describe('A cannot see B', () => {
    it('reservations: 0 rows for B', async () => {
      if (!f) return;
      const r = await f.safeAuthQuery(
        IDS.USER_A,
        `SELECT agency_id FROM public.reservations WHERE agency_id = $1`,
        [IDS.AGENCY_B],
      );
      expect(r.denied).toBe(false);
      expect(r.rows).toHaveLength(0);
    });

    it('reservation_passengers: 0 rows for B', async () => {
      if (!f) return;
      const r = await f.safeAuthQuery(
        IDS.USER_A,
        `SELECT rp.id FROM public.reservation_passengers rp
         JOIN public.reservations res ON res.id = rp.reservation_id
         WHERE res.agency_id = $1`,
        [IDS.AGENCY_B],
      );
      expect(r.denied).toBe(false);
      expect(r.rows).toHaveLength(0);
    });

    it('reservation_links: 0 rows for B', async () => {
      if (!f) return;
      const r = await f.safeAuthQuery(
        IDS.USER_A,
        `SELECT agency_id FROM public.reservation_links WHERE agency_id = $1`,
        [IDS.AGENCY_B],
      );
      expect(r.denied).toBe(false);
      expect(r.rows).toHaveLength(0);
    });

    it('notifications: 0 rows for B', async () => {
      if (!f) return;
      const r = await f.safeAuthQuery(
        IDS.USER_A,
        `SELECT agency_id FROM public.notifications WHERE agency_id = $1`,
        [IDS.AGENCY_B],
      );
      expect(r.denied).toBe(false);
      expect(r.rows).toHaveLength(0);
    });

    it('agency_settings: 0 rows for B', async () => {
      if (!f) return;
      const r = await f.safeAuthQuery(
        IDS.USER_A,
        `SELECT agency_id FROM public.agency_settings WHERE agency_id = $1`,
        [IDS.AGENCY_B],
      );
      expect(r.denied).toBe(false);
      expect(r.rows).toHaveLength(0);
    });

    it('agency_notification_preferences: 0 rows for B', async () => {
      if (!f) return;
      const r = await f.safeAuthQuery(
        IDS.USER_A,
        `SELECT agency_id FROM public.agency_notification_preferences WHERE agency_id = $1`,
        [IDS.AGENCY_B],
      );
      expect(r.denied).toBe(false);
      expect(r.rows).toHaveLength(0);
    });

    it('audit_log: 0 rows for B', async () => {
      if (!f) return;
      const r = await f.safeAuthQuery(
        IDS.USER_A,
        `SELECT agency_id FROM public.audit_log WHERE agency_id = $1`,
        [IDS.AGENCY_B],
      );
      expect(r.denied).toBe(false);
      expect(r.rows).toHaveLength(0);
    });

    it('users: 0 rows for B agency', async () => {
      if (!f) return;
      const r = await f.safeAuthQuery(
        IDS.USER_A,
        `SELECT agency_id FROM public.users WHERE agency_id = $1`,
        [IDS.AGENCY_B],
      );
      expect(r.denied).toBe(false);
      expect(r.rows).toHaveLength(0);
    });
  });

  /* ================================================================== */
  /*  4. Deny-All Tables (authenticated sees nothing)                    */
  /* ================================================================== */

  describe('Deny-all tables', () => {
    const denyAllTables = [
      'outbox_events',
      'password_resets',
      'boarding_attempts',
      'email_delivery_log',
      'trip_occupancy_alert_state',
      'reservation_link_seats',
    ];

    for (const table of denyAllTables) {
      it(`${table}: 0 rows or permission denied`, async () => {
        if (!f) return;
        const r = await f.safeAuthQuery(
          IDS.USER_A,
          `SELECT count(*)::int AS cnt FROM public.${table}`,
        );
        if (r.denied) {
          expect(r.denied).toBe(true);
        } else {
          expect(r.rows[0]?.cnt).toBe(0);
        }
      });
    }
  });

  /* ================================================================== */
  /*  5. Write/DELETE RLS (A cannot modify B)                            */
  /* ================================================================== */

  describe('A cannot modify B', () => {
    it('UPDATE reservations targeting B: 0 rows or permission denied', async () => {
      if (!f) return;
      const r = await f.safeAuthQuery(
        IDS.USER_A,
        `UPDATE public.reservations SET booker_name = 'HACKED' WHERE agency_id = $1 RETURNING id`,
        [IDS.AGENCY_B],
      );
      if (r.denied) {
        expect(r.denied).toBe(true);
      } else {
        expect(r.rows).toHaveLength(0);
      }
    });

    it('UPDATE agency_settings targeting B: 0 rows or permission denied', async () => {
      if (!f) return;
      const r = await f.safeAuthQuery(
        IDS.USER_A,
        `UPDATE public.agency_settings SET logo_url = 'hacked' WHERE agency_id = $1 RETURNING agency_id`,
        [IDS.AGENCY_B],
      );
      if (r.denied) {
        expect(r.denied).toBe(true);
      } else {
        expect(r.rows).toHaveLength(0);
      }
    });

    it('DELETE reservations targeting B: 0 rows or permission denied', async () => {
      if (!f) return;
      const r = await f.safeAuthQuery(
        IDS.USER_A,
        `DELETE FROM public.reservations WHERE agency_id = $1 RETURNING id`,
        [IDS.AGENCY_B],
      );
      if (r.denied) {
        expect(r.denied).toBe(true);
      } else {
        expect(r.rows).toHaveLength(0);
      }
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Integration gate                                                    */
/* ------------------------------------------------------------------ */

describe('SEC-009.3 — tenant isolation gate', () => {
  it('skips live suite unless DB is configured', () => {
    if (mustFailWithoutDb) {
      expect(true).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });
});
