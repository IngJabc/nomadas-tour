import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database module at the top level to prevent env validation
const mockFrom = vi.fn();
vi.mock('../config/database.js', () => ({
  get supabaseAdmin() {
    return { from: mockFrom };
  },
}));

import {
  validateTripEditable,
  validateVehicleChange,
  validateAgencyRemoval,
  validateNoActiveReservations,
  type TripOperationalContext,
} from './trip-edit-context.js';

// ── Helpers ─────────────────────────────────────────────────────────

function makeContext(overrides: Partial<TripOperationalContext> = {}): TripOperationalContext {
  const futureDate = new Date(Date.now() + 86_400_000).toISOString();

  return {
    trip: {
      id: 'trip-1',
      status: 'active',
      departure_time: futureDate,
      capacity: 31,
      vehicle_type: 'bus',
      route_id: 'route-1',
    },
    activeReservationCount: 0,
    activeReservationsByAgency: {},
    lockedSeatCount: 0,
    boardedPassengerCount: 0,
    currentAgencyIds: ['agency-1', 'agency-2'],
    ...overrides,
  };
}

function pastDate(): string {
  return new Date(Date.now() - 86_400_000).toISOString();
}

// ── validateTripEditable ────────────────────────────────────────────

describe('validateTripEditable', () => {
  it('allows editing an active trip with future departure', () => {
    const ctx = makeContext();
    expect(() => validateTripEditable(ctx)).not.toThrow();
  });

  it('rejects completed trips', () => {
    const ctx = makeContext({ trip: { ...makeContext().trip, status: 'completed' } });
    expect(() => validateTripEditable(ctx)).toThrow('completado');
  });

  it('rejects cancelled trips', () => {
    const ctx = makeContext({ trip: { ...makeContext().trip, status: 'cancelled' } });
    expect(() => validateTripEditable(ctx)).toThrow('cancelado');
  });

  it('rejects trips whose departure time has passed', () => {
    const ctx = makeContext({
      trip: { ...makeContext().trip, departure_time: pastDate() },
    });
    expect(() => validateTripEditable(ctx)).toThrow('hora de salida ya pasó');
  });

  it('rejects trips with boarded passengers', () => {
    const ctx = makeContext({ boardedPassengerCount: 5 });
    expect(() => validateTripEditable(ctx)).toThrow('5 pasajero(s) ya abordado(s)');
  });

  it('rejects trips with 1 boarded passenger', () => {
    const ctx = makeContext({ boardedPassengerCount: 1 });
    expect(() => validateTripEditable(ctx)).toThrow('1 pasajero(s) ya abordado(s)');
  });
});

// ── validateVehicleChange ───────────────────────────────────────────

describe('validateVehicleChange', () => {
  it('allows keeping the same vehicle type', () => {
    const ctx = makeContext();
    expect(() => validateVehicleChange(ctx, 'bus')).not.toThrow();
  });

  it('allows changing vehicle type when no activity exists', () => {
    const ctx = makeContext();
    expect(() => validateVehicleChange(ctx, 'kia')).not.toThrow();
  });

  it('blocks vehicle change when active reservations exist', () => {
    const ctx = makeContext({ activeReservationCount: 10 });
    expect(() => validateVehicleChange(ctx, 'kia')).toThrow('reserva(s) activa(s)');
  });

  it('blocks vehicle change when locks exist', () => {
    const ctx = makeContext({ lockedSeatCount: 3 });
    expect(() => validateVehicleChange(ctx, 'kia')).toThrow('asiento(s) bloqueado(s)');
  });

  it('blocks vehicle change when boarded passengers exist', () => {
    const ctx = makeContext({ boardedPassengerCount: 2 });
    expect(() => validateVehicleChange(ctx, 'kia')).toThrow('pasajeros abordados');
  });

  it('blocks vehicle change with multiple conditions', () => {
    const ctx = makeContext({
      activeReservationCount: 5,
      lockedSeatCount: 2,
      boardedPassengerCount: 1,
    });
    expect(() => validateVehicleChange(ctx, 'kia')).toThrow('reserva(s) activa(s)');
  });
});

// ── validateAgencyRemoval ───────────────────────────────────────────

describe('validateAgencyRemoval', () => {
  it('allows adding new agencies', () => {
    const ctx = makeContext();
    expect(() => validateAgencyRemoval(ctx, ['agency-1', 'agency-2', 'agency-3'])).not.toThrow();
  });

  it('allows keeping the same agencies', () => {
    const ctx = makeContext();
    expect(() => validateAgencyRemoval(ctx, ['agency-1', 'agency-2'])).not.toThrow();
  });

  it('allows removing an agency with no active reservations', () => {
    const ctx = makeContext({
      activeReservationsByAgency: { 'agency-1': 0 },
    });
    expect(() => validateAgencyRemoval(ctx, ['agency-1'])).not.toThrow();
  });

  it('allows removing an agency that only has cancelled reservations', () => {
    const ctx = makeContext({
      activeReservationsByAgency: {},
    });
    expect(() => validateAgencyRemoval(ctx, ['agency-1'])).not.toThrow();
  });

  it('blocks removing an agency with active reservations', () => {
    const ctx = makeContext({
      activeReservationsByAgency: { 'agency-2': 5 },
    });
    expect(() => validateAgencyRemoval(ctx, ['agency-1'])).toThrow('desasignar la agencia');
    expect(() => validateAgencyRemoval(ctx, ['agency-1'])).toThrow('5 reserva(s) activa(s)');
  });

  it('blocks removing an agency with 1 active reservation', () => {
    const ctx = makeContext({
      activeReservationsByAgency: { 'agency-1': 1 },
    });
    expect(() => validateAgencyRemoval(ctx, [])).toThrow('1 reserva(s) activa(s)');
  });

  it('allows removing an agency not in currentAgencyIds (no-op)', () => {
    const ctx = makeContext();
    expect(() => validateAgencyRemoval(ctx, ['agency-1', 'agency-2'])).not.toThrow();
  });

  it('blocks each agency independently', () => {
    const ctx = makeContext({
      activeReservationsByAgency: { 'agency-1': 3, 'agency-2': 7 },
    });
    expect(() => validateAgencyRemoval(ctx, [])).toThrow();
  });
});

// ── validateNoActiveReservations ──────────────────────────────────

describe('validateNoActiveReservations', () => {
  it('allows editing when no active reservations exist', () => {
    const ctx = makeContext({ activeReservationCount: 0 });
    expect(() => validateNoActiveReservations(ctx)).not.toThrow();
  });

  it('blocks editing when active reservations exist', () => {
    const ctx = makeContext({ activeReservationCount: 5 });
    expect(() => validateNoActiveReservations(ctx)).toThrow('reservas activas');
  });

  it('blocks editing with exactly 1 active reservation', () => {
    const ctx = makeContext({ activeReservationCount: 1 });
    expect(() => validateNoActiveReservations(ctx)).toThrow('reservas activas');
  });

  it('blocks editing with large number of active reservations', () => {
    const ctx = makeContext({ activeReservationCount: 100 });
    expect(() => validateNoActiveReservations(ctx)).toThrow('posponer o cancelar');
  });
});

describe('getTripOperationalContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds context from Supabase queries', async () => {
    const { getTripOperationalContext } = await import('./trip-edit-context.js');

    const mockTrip = {
      id: 'trip-1',
      status: 'active',
      departure_time: new Date(Date.now() + 86_400_000).toISOString(),
      capacity: 31,
      vehicle_type: 'bus',
      route_id: 'route-1',
    };

    const mockReservations = [
      { id: 'res-1', agency_id: 'agency-1' },
      { id: 'res-2', agency_id: 'agency-2' },
      { id: 'res-3', agency_id: 'agency-1' },
    ];

    const mockTripAgencies = [
      { agency_id: 'agency-1' },
      { agency_id: 'agency-2' },
    ];

    const mockAllRes = [
      { id: 'res-1' },
      { id: 'res-2' },
      { id: 'res-3' },
    ];

    function buildQuery(result: any, error: any = null, count?: number) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        single: () => Promise.resolve({ data: result, error }),
        then: (resolve: any) => resolve({ data: result, error, count: count ?? (result?.length ?? 0) }),
      };
      return chain;
    }

    const calls: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      calls.push(table);
      if (table === 'trips') return buildQuery(mockTrip);
      if (table === 'reservations') {
        if (calls.filter(c => c === 'reservations').length <= 1) {
          return buildQuery(mockReservations);
        }
        return buildQuery(mockAllRes);
      }
      if (table === 'seats') return buildQuery(null, null, 0);
      if (table === 'trip_agencies') return buildQuery(mockTripAgencies);
      if (table === 'reservation_passengers') return buildQuery(null, null, 2);
      return buildQuery([]);
    });

    const ctx = await getTripOperationalContext('trip-1');

    expect(ctx.trip.id).toBe('trip-1');
    expect(ctx.trip.status).toBe('active');
    expect(ctx.activeReservationCount).toBe(3);
    expect(ctx.activeReservationsByAgency).toEqual({ 'agency-1': 2, 'agency-2': 1 });
    expect(ctx.lockedSeatCount).toBe(0);
    expect(ctx.boardedPassengerCount).toBe(2);
    expect(ctx.currentAgencyIds).toEqual(['agency-1', 'agency-2']);
  });

  it('throws when trip is not found', async () => {
    const { getTripOperationalContext } = await import('./trip-edit-context.js');

    function buildQuery(result: any, error: any = null) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        single: () => Promise.resolve({ data: result, error }),
        then: (resolve: any) => resolve({ data: result, error }),
      };
      return chain;
    }

    mockFrom.mockImplementation(() => buildQuery(null, { message: 'not found' }));

    await expect(getTripOperationalContext('nonexistent')).rejects.toThrow('Trip not found');
  });
});
