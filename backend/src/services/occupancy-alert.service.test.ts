import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  classifyOccupancyCounts,
  computeCanonicalOccupancy,
  decideOccupancyTransition,
  isOccupancyUrgency,
  listAgencyOccupancyAlerts,
  OCCUPANCY_URGENCY_WINDOW_MS,
  persistedStateFromAlertType,
} from './occupancy-alert.service.js';

const tableChains: Record<string, any> = {};
const mockFrom = vi.fn((table: string) => tableChains[table]);

vi.mock('../config/database.js', () => ({
  get supabaseAdmin() {
    return { from: mockFrom };
  },
}));

function chain(data: unknown, error: unknown = null) {
  const api: any = {};
  api.select = vi.fn(() => api);
  api.eq = vi.fn(() => api);
  api.in = vi.fn(() => api);
  api.gt = vi.fn(() => api);
  api.order = vi.fn(() => Promise.resolve({ data, error }));
  api.then = (resolve: (value: unknown) => void) =>
    resolve({ data, error });
  return api;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) delete tableChains[key];
});

describe('F4-003 — canonical occupancy', () => {
  it('counts reserved as status != available (locked/blocked included)', () => {
    const occupancy = computeCanonicalOccupancy(
      [
        { status: 'available' },
        { status: 'reserved' },
        { status: 'locked' },
        { status: 'blocked' },
      ],
      10,
    );
    expect(occupancy).toMatchObject({
      ok: true,
      reserved: 3,
      total: 4,
      occupancy_pct: 75,
    });
  });

  it('falls back to capacity when there are no seat rows', () => {
    expect(computeCanonicalOccupancy([], 10)).toMatchObject({
      ok: true,
      reserved: 0,
      total: 10,
      occupancy_pct: 0,
    });
  });

  it('90 triggers near_full and 89 does not', () => {
    expect(decideOccupancyTransition('NORMAL', classifyOccupancyCounts(9, 10))).toEqual({
      kind: 'enter',
      alertType: 'near_full',
    });
    expect(decideOccupancyTransition('NORMAL', classifyOccupancyCounts(89, 100))).toEqual({
      kind: 'noop',
    });
  });

  it('85 stays near_full and 84 resets', () => {
    expect(
      decideOccupancyTransition('NEAR_FULL_ALERTED', classifyOccupancyCounts(85, 100)),
    ).toEqual({ kind: 'noop' });
    expect(
      decideOccupancyTransition('NEAR_FULL_ALERTED', classifyOccupancyCounts(84, 100)),
    ).toEqual({ kind: 'reset' });
  });

  it('20 triggers underbooked and 21 does not', () => {
    expect(decideOccupancyTransition('NORMAL', classifyOccupancyCounts(2, 10))).toEqual({
      kind: 'enter',
      alertType: 'underbooked',
    });
    expect(decideOccupancyTransition('NORMAL', classifyOccupancyCounts(21, 100))).toEqual({
      kind: 'noop',
    });
  });

  it('25 stays underbooked and 26 resets', () => {
    expect(
      decideOccupancyTransition('UNDERBOOKED_ALERTED', classifyOccupancyCounts(25, 100)),
    ).toEqual({ kind: 'noop' });
    expect(
      decideOccupancyTransition('UNDERBOOKED_ALERTED', classifyOccupancyCounts(26, 100)),
    ).toEqual({ kind: 'reset' });
  });

  it('skips total<=0 and reserved>total without a transition', () => {
    expect(decideOccupancyTransition('NORMAL', classifyOccupancyCounts(0, 0))).toEqual({
      kind: 'skip_invalid',
      reason: 'total_lte_zero',
    });
    expect(decideOccupancyTransition('NORMAL', classifyOccupancyCounts(11, 10))).toEqual({
      kind: 'skip_invalid',
      reason: 'reserved_gt_total',
    });
  });
});

describe('F4-003 — state machine', () => {
  it('stays put while alerted and rearms after reset', () => {
    expect(
      decideOccupancyTransition('NEAR_FULL_ALERTED', classifyOccupancyCounts(93, 100)),
    ).toEqual({ kind: 'noop' });

    const reset = decideOccupancyTransition(
      'NEAR_FULL_ALERTED',
      classifyOccupancyCounts(15, 100),
    );
    expect(reset).toEqual({ kind: 'reset' });

    expect(
      decideOccupancyTransition(
        persistedStateFromAlertType(null),
        classifyOccupancyCounts(15, 100),
      ),
    ).toEqual({ kind: 'enter', alertType: 'underbooked' });
  });

  it('never chains near_full reset and underbooked enter in one decision', () => {
    const decision = decideOccupancyTransition(
      'NEAR_FULL_ALERTED',
      classifyOccupancyCounts(15, 100),
    );
    expect(decision.kind).toBe('reset');
    expect(decision).not.toMatchObject({ alertType: 'underbooked' });
  });
});

describe('F4-003 — listAgencyOccupancyAlerts tenancy', () => {
  it('returns only alerted trips associated to the agency with live values', async () => {
    const agencyTrip = 'trip-agency';
    tableChains.trip_agencies = chain([{ trip_id: agencyTrip }]);
    tableChains.trip_occupancy_alert_state = chain([
      { trip_id: agencyTrip, alert_type: 'near_full' },
      { trip_id: 'trip-other', alert_type: 'underbooked' },
    ]);
    tableChains.trips = chain([
      {
        id: agencyTrip,
        capacity: 10,
        departure_time: '2026-08-20T12:00:00.000Z',
        routes: { origin: 'Caracas', destination: 'Mérida' },
      },
    ]);
    tableChains.seats = chain([
      { trip_id: agencyTrip, status: 'reserved' },
      { trip_id: agencyTrip, status: 'reserved' },
      { trip_id: agencyTrip, status: 'available' },
    ]);

    const rows = await listAgencyOccupancyAlerts('agency-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      trip_id: agencyTrip,
      alert_type: 'near_full',
      origin: 'Caracas',
      destination: 'Mérida',
      reserved: 2,
      capacity: 3,
      available: 1,
      occupancy_pct: 67,
    });
    expect(rows.some((row) => row.trip_id === 'trip-other')).toBe(false);
  });

  it('returns empty when the agency has no associated trips', async () => {
    tableChains.trip_agencies = chain([]);
    await expect(listAgencyOccupancyAlerts('agency-empty')).resolves.toEqual([]);
    expect(tableChains.trip_occupancy_alert_state).toBeUndefined();
  });
});

describe('F4-004 — urgency derivation and ordering', () => {
  it('marks departure within 24h as urgent and outside as not', () => {
    const now = Date.parse('2026-08-14T12:00:00.000Z');
    expect(
      isOccupancyUrgency(
        new Date(now + OCCUPANCY_URGENCY_WINDOW_MS).toISOString(),
        now,
      ),
    ).toBe(true);
    expect(
      isOccupancyUrgency(
        new Date(now + OCCUPANCY_URGENCY_WINDOW_MS + 1).toISOString(),
        now,
      ),
    ).toBe(false);
    expect(
      isOccupancyUrgency(new Date(now - 1).toISOString(), now),
    ).toBe(false);
  });

  it('sorts urgency alerts before normal and keeps departure ASC within groups', async () => {
    const urgentTrip = 'trip-urgent';
    const laterUrgent = 'trip-urgent-later';
    const normalTrip = 'trip-normal';
    const now = Date.now();
    const in6h = new Date(now + 6 * 60 * 60 * 1000).toISOString();
    const in12h = new Date(now + 12 * 60 * 60 * 1000).toISOString();
    const in48h = new Date(now + 48 * 60 * 60 * 1000).toISOString();

    tableChains.trip_agencies = chain([
      { trip_id: urgentTrip },
      { trip_id: laterUrgent },
      { trip_id: normalTrip },
    ]);
    tableChains.trip_occupancy_alert_state = chain([
      { trip_id: urgentTrip, alert_type: 'underbooked' },
      { trip_id: laterUrgent, alert_type: 'near_full' },
      { trip_id: normalTrip, alert_type: 'near_full' },
    ]);
    // Returned ASC by departure from query mock — service re-sorts by urgency.
    tableChains.trips = chain([
      {
        id: urgentTrip,
        capacity: 10,
        departure_time: in6h,
        routes: { origin: 'A', destination: 'Urgente' },
      },
      {
        id: laterUrgent,
        capacity: 10,
        departure_time: in12h,
        routes: { origin: 'A', destination: 'Urgente2' },
      },
      {
        id: normalTrip,
        capacity: 10,
        departure_time: in48h,
        routes: { origin: 'A', destination: 'Normal' },
      },
    ]);
    tableChains.seats = chain([
      { trip_id: urgentTrip, status: 'reserved' },
      { trip_id: urgentTrip, status: 'available' },
      { trip_id: laterUrgent, status: 'reserved' },
      { trip_id: laterUrgent, status: 'reserved' },
      { trip_id: laterUrgent, status: 'available' },
      { trip_id: normalTrip, status: 'reserved' },
      { trip_id: normalTrip, status: 'reserved' },
      { trip_id: normalTrip, status: 'available' },
    ]);

    const rows = await listAgencyOccupancyAlerts('agency-1');
    expect(rows.map((r) => r.trip_id)).toEqual([
      urgentTrip,
      laterUrgent,
      normalTrip,
    ]);
    expect(rows[0].urgency).toBe(true);
    expect(rows[1].urgency).toBe(true);
    expect(rows[2].urgency).toBe(false);
  });
});
