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

import { businessDayBoundsUtc } from '../utils/timezone.js';
import {
  IDENTITY_GAP_EMAIL_DOMAIN,
  SUPERADMIN_DIGEST_OCCUPANCY_LIMIT,
  SUPERADMIN_DIGEST_UPCOMING_HOURS,
  SUPERADMIN_DIGEST_UPCOMING_LIMIT,
  isEligibleSuperadminEmail,
  isSuperadminDigestEmpty,
  isSyntheticIdentityGapEmail,
  loadEligibleSuperadmins,
  loadSuperadminDigestAggregates,
  type SuperadminDigestAggregates,
} from './superadmin-digest.service.js';

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

function emptyAggregates(
  overrides: Partial<SuperadminDigestAggregates> = {},
): SuperadminDigestAggregates {
  return {
    digest_date: '2026-08-13',
    total_agencies: 3,
    active_agencies: 2,
    active_trips: 0,
    today_reservations: 0,
    pending_boarding_passengers: 0,
    upcoming_trips: [],
    occupancy_by_trip: [
      {
        trip_id: 'occ-1',
        label: 'A → B',
        departure: '2026-08-01T12:00:00.000Z',
        total: 10,
        reserved: 4,
        occupancy_pct: 40,
      },
    ],
    dashboard_url: 'http://localhost:3000/admin',
    ...overrides,
  };
}

describe('F4-002 — superadmin digest eligibility helpers', () => {
  it('excludes empty, whitespace, and identity-gap emails case-insensitively', () => {
    expect(isEligibleSuperadminEmail(null)).toBe(false);
    expect(isEligibleSuperadminEmail('')).toBe(false);
    expect(isEligibleSuperadminEmail('   ')).toBe(false);
    expect(
      isSyntheticIdentityGapEmail(
        `  ABC@${IDENTITY_GAP_EMAIL_DOMAIN.toUpperCase()}  `,
      ),
    ).toBe(true);
    expect(
      isEligibleSuperadminEmail(`gap@${IDENTITY_GAP_EMAIL_DOMAIN}`),
    ).toBe(false);
    expect(isEligibleSuperadminEmail('ops@nomadas.tour')).toBe(true);
  });

  it('treats occupancy-only snapshot as empty digest', () => {
    expect(isSuperadminDigestEmpty(emptyAggregates())).toBe(true);
    expect(
      isSuperadminDigestEmpty(emptyAggregates({ active_trips: 1 })),
    ).toBe(false);
    expect(
      isSuperadminDigestEmpty(emptyAggregates({ today_reservations: 1 })),
    ).toBe(false);
    expect(
      isSuperadminDigestEmpty(
        emptyAggregates({ pending_boarding_passengers: 1 }),
      ),
    ).toBe(false);
    expect(
      isSuperadminDigestEmpty(
        emptyAggregates({
          upcoming_trips: [
            {
              trip_id: 't1',
              route_label: 'A → B',
              departure_time: '2026-08-13T12:00:00.000Z',
              departure_formatted: 'fmt',
              reservation_count: 0,
              capacity: 10,
              available_seats: 10,
              occupancy_pct: 0,
            },
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe('F4-002 — loadEligibleSuperadmins', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('keeps only superadmins with valid email and prefs on', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return chainable({
          data: [
            { id: 'sa-1', email: 'one@nomadas.tour', role: 'superadmin' },
            { id: 'sa-2', email: '  ', role: 'superadmin' },
            {
              id: 'sa-3',
              email: `x@${IDENTITY_GAP_EMAIL_DOMAIN}`,
              role: 'superadmin',
            },
            { id: 'sa-4', email: 'off@nomadas.tour', role: 'superadmin' },
            { id: 'ag-1', email: 'agency@test.com', role: 'agency' },
          ],
        });
      }
      if (table === 'superadmin_notification_preferences') {
        return chainable({
          data: [
            { user_id: 'sa-1', email_enabled: true, category: 'superadmin_digest' },
            { user_id: 'sa-4', email_enabled: false, category: 'superadmin_digest' },
          ],
        });
      }
      return chainable({});
    });

    const recipients = await loadEligibleSuperadmins();
    expect(recipients).toEqual([
      { user_id: 'sa-1', email: 'one@nomadas.tour' },
    ]);
    expect(JSON.stringify(recipients)).not.toMatch(/agency@test.com/);
  });
});

describe('F4-002 — superadmin digest aggregates', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('exports 48h window, max 10 upcoming, max 10 occupancy', () => {
    expect(SUPERADMIN_DIGEST_UPCOMING_HOURS).toBe(48);
    expect(SUPERADMIN_DIGEST_UPCOMING_LIMIT).toBe(10);
    expect(SUPERADMIN_DIGEST_OCCUPANCY_LIMIT).toBe(10);
  });

  it('loads global KPIs, Caracas today bounds, upcoming 48h/10, occupancy 10, no PII', async () => {
    const bounds = businessDayBoundsUtc('2026-08-13');
    const reservationGte: Array<[string, string]> = [];
    const reservationLt: Array<[string, string]> = [];
    const tripLimits: number[] = [];
    const tripStatusIn: unknown[] = [];
    const reservationAgencyEq: Array<[string, string]> = [];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'agencies') {
        return chainable({ count: 4 });
      }
      if (table === 'reservation_passengers') {
        return chainable({ data: [{ id: 'p1' }, { id: 'p2' }] });
      }
      if (table === 'reservations') {
        const chain = chainable({
          count: 7,
          data: [{ trip_id: 'trip-1' }, { trip_id: 'trip-1' }],
        });
        const origGte = chain.gte;
        const origLt = chain.lt;
        const origEq = chain.eq;
        chain.gte = vi.fn((col: string, val: string) => {
          reservationGte.push([col, val]);
          return origGte(col, val);
        });
        chain.lt = vi.fn((col: string, val: string) => {
          reservationLt.push([col, val]);
          return origLt(col, val);
        });
        chain.eq = vi.fn((col: string, val: string) => {
          reservationAgencyEq.push([col, val]);
          return origEq(col, val);
        });
        return chain;
      }
      if (table === 'trips') {
        const chain = chainable({
          count: 3,
          data: [
            {
              id: 'trip-1',
              departure_time: '2026-08-13T16:00:00.000Z',
              capacity: 10,
              routes: { origin: 'Caracas', destination: 'Mérida' },
            },
          ],
        });
        const origLimit = chain.limit;
        const origIn = chain.in;
        chain.limit = vi.fn((n: number) => {
          tripLimits.push(n);
          return origLimit(n);
        });
        chain.in = vi.fn((col: string, val: unknown) => {
          if (col === 'status') tripStatusIn.push(val);
          return origIn(col, val);
        });
        return chain;
      }
      if (table === 'seats') {
        return chainable({
          data: [
            { trip_id: 'trip-1', status: 'available' },
            { trip_id: 'trip-1', status: 'reserved' },
            { trip_id: 'trip-1', status: 'blocked' },
          ],
        });
      }
      return chainable({});
    });

    const result = await loadSuperadminDigestAggregates(
      '2026-08-13',
      new Date('2026-08-13T12:00:00.000Z'),
    );

    expect(result.total_agencies).toBe(4);
    expect(result.active_agencies).toBe(4);
    expect(result.active_trips).toBe(3);
    expect(result.today_reservations).toBe(7);
    expect(result.pending_boarding_passengers).toBe(2);
    expect(result.dashboard_url).toBe('http://localhost:3000/admin');
    expect(reservationGte).toContainEqual(['created_at', bounds.startIso]);
    expect(reservationLt).toContainEqual(['created_at', bounds.endIsoExclusive]);
    expect(tripLimits).toContain(10);
    expect(tripStatusIn).toContainEqual(['active', 'completed']);
    expect(reservationAgencyEq.map(([col]) => col)).not.toContain('agency_id');
    expect(result.upcoming_trips).toHaveLength(1);
    expect(result.upcoming_trips[0].reservation_count).toBe(2);
    expect(result.upcoming_trips[0].available_seats).toBe(1);
    expect(result.upcoming_trips[0].occupancy_pct).toBe(67);
    expect(result.occupancy_by_trip).toHaveLength(1);
    expect(result.occupancy_by_trip[0].reserved).toBe(2);
    expect(result.occupancy_by_trip[0].occupancy_pct).toBe(67);
    expect(JSON.stringify(result)).not.toMatch(
      /booker_name|contact_email|passenger_name|"phone"|"document"/i,
    );
    expect(result).not.toHaveProperty('recent_activity');
  });
});
