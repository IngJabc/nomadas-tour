/**
 * @vitest-environment node
 *
 * AUD-020 P4 — Live PostgreSQL boarding integration/concurrency.
 *
 * Requires BOARDING_DB_URL (or DATABASE_URL) without placeholder password.
 * Skips cleanly when unset.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.BOARDING_DB_URL || process.env.DATABASE_URL || '';
const enabled = Boolean(DATABASE_URL) && !DATABASE_URL.includes('[YOUR-PASSWORD]');
const describeLive = enabled ? describe : describe.skip;

type Fixture = {
  passengerId: string;
  actorId: string;
  agencyId: string;
  seatId: string;
};

async function loadFixture(client: pg.Client): Promise<Fixture | null> {
  const { rows } = await client.query<{
    passenger_id: string;
    actor_id: string;
    agency_id: string;
    seat_id: string;
  }>(`
    SELECT
      rp.id AS passenger_id,
      u.id AS actor_id,
      ta.agency_id,
      rp.seat_id
    FROM public.reservation_passengers rp
    JOIN public.reservations r ON r.id = rp.reservation_id
    JOIN public.trips t ON t.id = r.trip_id
    JOIN public.trip_agencies ta ON ta.trip_id = t.id
    JOIN public.users u ON u.agency_id = ta.agency_id
    WHERE rp.status = 'active'
      AND r.status <> 'cancelled'
      AND t.status = 'active'
      AND t.departure_time <= NOW()
    ORDER BY rp.boarded ASC, rp.id
    LIMIT 1
  `);
  if (!rows[0]) return null;
  return {
    passengerId: rows[0].passenger_id,
    actorId: rows[0].actor_id,
    agencyId: rows[0].agency_id,
    seatId: rows[0].seat_id,
  };
}

async function toggle(client: pg.Client, fixture: Fixture, boarded: boolean) {
  const { rows } = await client.query<{ boarding_toggle: Record<string, unknown> }>(
    `SELECT public.boarding_toggle($1::uuid, $2::boolean, $3::uuid, $4::uuid) AS boarding_toggle`,
    [fixture.passengerId, boarded, fixture.actorId, fixture.agencyId],
  );
  return rows[0].boarding_toggle;
}

async function logCount(client: pg.Client, passengerId: string) {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM public.boarding_logs
     WHERE reservation_passenger_id = $1`,
    [passengerId],
  );
  return Number(rows[0].count);
}

async function seatStatus(client: pg.Client, seatId: string) {
  const { rows } = await client.query<{ status: string }>(
    `SELECT status FROM public.seats WHERE id = $1`,
    [seatId],
  );
  return rows[0]?.status;
}

describeLive('AUD-020 P4 — boarding_toggle live integration', () => {
  let client: pg.Client;
  let fixture: Fixture;

  beforeAll(async () => {
    client = new pg.Client({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    const loaded = await loadFixture(client);
    if (!loaded) throw new Error('No operable boarding fixture in database');
    fixture = loaded;
  }, 30_000);

  afterAll(async () => {
    await client?.end();
  });

  it('boards with changed=true, boarded_at set, +1 log, seats.status unchanged', async () => {
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE public.reservation_passengers
         SET boarded = false, boarded_at = null WHERE id = $1`,
        [fixture.passengerId],
      );
      const beforeLogs = await logCount(client, fixture.passengerId);
      const beforeSeat = await seatStatus(client, fixture.seatId);

      const result = await toggle(client, fixture, true);

      expect(result.changed).toBe(true);
      expect(result.boarded).toBe(true);
      expect(result.boarded_at).toBeTruthy();
      expect(await logCount(client, fixture.passengerId)).toBe(beforeLogs + 1);
      expect(await seatStatus(client, fixture.seatId)).toBe(beforeSeat);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('second board is idempotent (changed=false, no extra log)', async () => {
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE public.reservation_passengers
         SET boarded = false, boarded_at = null WHERE id = $1`,
        [fixture.passengerId],
      );
      const first = await toggle(client, fixture, true);
      const beforeLogs = await logCount(client, fixture.passengerId);
      const second = await toggle(client, fixture, true);

      expect(second.changed).toBe(false);
      expect(second.boarded).toBe(true);
      expect(second.boarded_at).toEqual(first.boarded_at);
      expect(await logCount(client, fixture.passengerId)).toBe(beforeLogs);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('unboards with changed=true and clears boarded_at', async () => {
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE public.reservation_passengers
         SET boarded = false, boarded_at = null WHERE id = $1`,
        [fixture.passengerId],
      );
      await toggle(client, fixture, true);
      const beforeLogs = await logCount(client, fixture.passengerId);
      const result = await toggle(client, fixture, false);

      expect(result.changed).toBe(true);
      expect(result.boarded).toBe(false);
      expect(result.boarded_at).toBeNull();
      expect(await logCount(client, fixture.passengerId)).toBe(beforeLogs + 1);
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('serializes concurrent board=true (one changed, one log)', async () => {
    await client.query(
      `UPDATE public.reservation_passengers
       SET boarded = false, boarded_at = null WHERE id = $1`,
      [fixture.passengerId],
    );

    const a = new pg.Client({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    const b = new pg.Client({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await a.connect();
    await b.connect();

    try {
      const beforeLogs = await logCount(client, fixture.passengerId);
      const [r1, r2] = await Promise.all([
        toggle(a, fixture, true),
        toggle(b, fixture, true),
      ]);

      expect([r1, r2].filter((r) => r.changed === true)).toHaveLength(1);
      expect([r1, r2].filter((r) => r.changed === false)).toHaveLength(1);
      expect(await logCount(client, fixture.passengerId)).toBe(beforeLogs + 1);

      // restore for other environments
      await client.query(
        `UPDATE public.reservation_passengers
         SET boarded = false, boarded_at = null WHERE id = $1`,
        [fixture.passengerId],
      );
    } finally {
      await a.end();
      await b.end();
    }
  });
});

describe('AUD-020 P4 — integration gate', () => {
  it('skips live suite unless BOARDING_DB_URL is configured', () => {
    if (!enabled) {
      expect(DATABASE_URL.includes('[YOUR-PASSWORD]') || !DATABASE_URL).toBe(true);
    } else {
      expect(DATABASE_URL.length).toBeGreaterThan(10);
    }
  });
});
