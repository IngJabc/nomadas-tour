import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();

vi.mock('../config/database.js', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock('../config/env.js', () => ({
  env: {
    FRONTEND_URL: 'http://localhost:3000',
  },
}));

vi.mock('../utils/email-fanout.js', () => ({
  formatDateForEmail: (iso: string) => `fmt:${iso}`,
}));

import {
  AGENCY_DIGEST_UPCOMING_HOURS,
  AGENCY_DIGEST_UPCOMING_LIMIT,
  loadAgencyDigestAggregates,
} from './agency-digest.service.js';

function chainable(result: {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}) {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({
      data: result.data ?? null,
      error: result.error ?? null,
    })),
    then: undefined as unknown,
  };
  chain.then = (resolve: (v: unknown) => void) => {
    resolve({
      data: result.data ?? null,
      error: result.error ?? null,
      count: result.count ?? null,
    });
  };
  return chain;
}

describe('F4-001 — agency digest aggregates', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('exports 48h window and max 10 trips', () => {
    expect(AGENCY_DIGEST_UPCOMING_HOURS).toBe(48);
    expect(AGENCY_DIGEST_UPCOMING_LIMIT).toBe(10);
  });

  it('returns null for inactive agency', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agencies') {
        return chainable({
          data: {
            id: 'agency-a',
            name: 'X',
            email: 'a@test.com',
            status: 'inactive',
          },
        });
      }
      return chainable({});
    });

    await expect(
      loadAgencyDigestAggregates('agency-a', '2026-08-12'),
    ).resolves.toBeNull();
  });

  it('returns null when agency has no email', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'agencies') {
        return chainable({
          data: {
            id: 'agency-a',
            name: 'X',
            email: '   ',
            status: 'active',
          },
        });
      }
      return chainable({});
    });

    await expect(
      loadAgencyDigestAggregates('agency-a', '2026-08-12'),
    ).resolves.toBeNull();
  });

  it('scopes reservation_count by agency_id and caps upcoming query at 10', async () => {
    const limitCalls: number[] = [];
    const reservationEqCalls: Array<[string, string]> = [];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'agencies') {
        return chainable({
          data: {
            id: 'agency-a',
            name: 'Agencia A',
            email: 'a@test.com',
            status: 'active',
          },
        });
      }
      if (table === 'trip_agencies') {
        return chainable({ count: 2 });
      }
      if (table === 'reservations') {
        const chain = chainable({
          count: 5,
          data: [{ trip_id: 'trip-1' }, { trip_id: 'trip-1' }],
        });
        const origEq = chain.eq;
        chain.eq = vi.fn((col: string, val: string) => {
          reservationEqCalls.push([col, val]);
          return origEq(col, val);
        });
        return chain;
      }
      if (table === 'reservation_passengers') {
        return chainable({ data: [{ id: 'p1' }] });
      }
      if (table === 'trips') {
        const chain = chainable({
          data: [
            {
              id: 'trip-1',
              departure_time: '2026-08-13T12:00:00.000Z',
              capacity: 31,
              routes: { origin: 'A', destination: 'B' },
            },
          ],
        });
        chain.limit = vi.fn((n: number) => {
          limitCalls.push(n);
          return chain;
        });
        return chain;
      }
      if (table === 'seats') {
        return chainable({
          data: [
            { trip_id: 'trip-1', status: 'available' },
            { trip_id: 'trip-1', status: 'reserved' },
          ],
        });
      }
      return chainable({});
    });

    const result = await loadAgencyDigestAggregates(
      'agency-a',
      '2026-08-12',
      new Date('2026-08-12T12:00:00.000Z'),
    );

    expect(result).not.toBeNull();
    expect(result!.agency_id).toBe('agency-a');
    expect(result!.active_trips).toBe(2);
    expect(result!.today_reservations).toBe(5);
    expect(result!.pending_boarding_passengers).toBe(1);
    expect(result!.upcoming_trips).toHaveLength(1);
    expect(result!.upcoming_trips[0].reservation_count).toBe(2);
    expect(result!.upcoming_trips[0].available_seats).toBe(1);
    expect(result!.upcoming_trips[0].occupancy_pct).toBe(50);
    expect(limitCalls).toContain(10);
    expect(reservationEqCalls).toContainEqual(['agency_id', 'agency-a']);
    expect(JSON.stringify(result)).not.toMatch(/booker_name|document|phone/i);
  });
});
