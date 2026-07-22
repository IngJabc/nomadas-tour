import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock database BEFORE any imports ────────────────────────────────
// The chainable mock must support the full Supabase query builder pattern:
// from(table).select().eq().in().single()  (read)
// from(table).update(data).eq()             (write)
// from(table).insert(rows)                  (write)
// from(table).delete().eq().in()            (write)

function createChainable(defaultResult: any = [], defaultError: any = null) {
  const chain: any = {};

  // Query builder methods return self for chaining
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.ilike = vi.fn(() => chain);

  // Terminal methods that return promises
  chain.single = vi.fn(() => Promise.resolve({ data: defaultResult, error: defaultError }));

  // update/insert/delete return a chainable that also has .eq() etc.
  chain.update = vi.fn((_data?: any) => {
    const updateChain = createChainable();
    // Wire up .eq on the update result
    updateChain._resolveUpdate = () => Promise.resolve({ error: null });
    return updateChain;
  });

  chain.insert = vi.fn((_rows?: any) => {
    return Promise.resolve({ error: null, data: null });
  });

  chain.delete = vi.fn(() => {
    const deleteChain = createChainable();
    return deleteChain;
  });

  // Thenable interface: .then((resolve) => resolve({data, error, count}))
  chain.then = vi.fn((resolve: any) => {
    const arr = Array.isArray(defaultResult) ? defaultResult : defaultResult ? [defaultResult] : [];
    resolve({ data: defaultResult, error: defaultError, count: arr.length });
  });

  return chain;
}

// Table-specific chains
const tableChains: Record<string, any> = {};

function buildTableChain(table: string) {
  if (!tableChains[table]) {
    tableChains[table] = createChainable();
  }
  return tableChains[table];
}

const mockFrom = vi.fn((table: string) => buildTableChain(table));

vi.mock('../config/database.js', () => ({
  get supabaseAdmin() {
    return { from: mockFrom };
  },
}));

vi.mock('./email.service.js', () => ({
  emailService: {
    sendTripPostponedEmail: vi.fn(),
    sendNewTripAssignedEmail: vi.fn(),
  },
}));

vi.mock('../utils/subdomain.js', () => ({
  generateUniqueSubdomain: vi.fn(),
}));

vi.mock('../utils/token.js', () => ({
  generateToken: vi.fn(),
}));

// ── Import after mocks ──────────────────────────────────────────────

import { superadminService } from './superadmin.service.js';

// ── Constants ───────────────────────────────────────────────────────

const FUTURE_DATE = new Date(Date.now() + 86_400_000).toISOString();
const PAST_DATE = new Date(Date.now() - 86_400_000).toISOString();

function makeTripRow(overrides: Record<string, any> = {}) {
  return {
    id: 'trip-1',
    status: 'active',
    departure_time: FUTURE_DATE,
    capacity: 31,
    vehicle_type: 'bus',
    route_id: 'route-1',
    ...overrides,
  };
}

function resetTableChains() {
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
}

// ── Default empty state setup ───────────────────────────────────────

function setupHappyPath(overrides: {
  tripOverrides?: Record<string, any>;
  activeReservations?: any[];
  lockedCount?: number;
  boardedCount?: number;
  currentAgencies?: any[];
  allReservations?: any[];
} = {}) {
  const {
    tripOverrides = {},
    activeReservations = [],
    lockedCount = 0,
    boardedCount = 0,
    currentAgencies = [{ agency_id: 'agency-1' }, { agency_id: 'agency-2' }],
    allReservations = [],
  } = overrides;

  // TRIPS: initial single() returns existing trip, update succeeds, final single returns full trip
  const trips = buildTableChain('trips');
  trips.single
    .mockResolvedValueOnce({ data: makeTripRow(tripOverrides), error: null })   // context fetch
    .mockResolvedValueOnce({                                                      // final fetch
      data: {
        ...makeTripRow(tripOverrides),
        routes: { origin: 'Caracas', destination: 'Maracaibo' },
        trip_agencies: currentAgencies,
      },
      error: null,
    });

  // Make update().eq() work: update returns a chain with .eq that resolves
  const updateChain = createChainable();
  updateChain.eq.mockImplementation(() => {
    return {
      then: (resolve: any) => resolve({ error: null }),
    };
  });
  trips.update.mockReturnValue(updateChain);

  // RESERVATIONS: active reservations query
  const reservations = buildTableChain('reservations');
  let resCallCount = 0;
  reservations.then.mockImplementation((resolve: any) => {
    resCallCount++;
    if (resCallCount === 1) {
      // First call: active reservations (confirmed/partial)
      resolve({ data: activeReservations, error: null, count: activeReservations.length });
    } else {
      // Second call: all reservations for boarded count
      resolve({ data: allReservations, error: null, count: allReservations.length });
    }
  });

  // SEATS: locked seats count
  const seats = buildTableChain('seats');
  seats.then.mockImplementation((resolve: any) => {
    resolve({ data: null, error: null, count: lockedCount });
  });

  // For capacity decrease: check reserved in excess range
  let seatsSelectCallCount = 0;
  seats.select.mockImplementation(() => {
    seatsSelectCallCount++;
    return seats;
  });

  // TRIP_AGENCIES
  const tripAgenciesChain = buildTableChain('trip_agencies');
  tripAgenciesChain.then.mockImplementation((resolve: any) => {
    resolve({ data: currentAgencies, error: null });
  });

  // RESERVATION_PASSENGERS: boarded count
  const rp = buildTableChain('reservation_passengers');
  rp.then.mockImplementation((resolve: any) => {
    resolve({ data: null, error: null, count: boardedCount });
  });

  // Insert/delete chains that resolve successfully
  seats.insert.mockResolvedValue({ error: null });

  const deleteChain = createChainable();
  deleteChain.eq.mockImplementation(() => deleteChain);
  deleteChain.in.mockImplementation(() => deleteChain);
  seats.delete.mockReturnValue(deleteChain);

  const taDeleteChain = createChainable();
  taDeleteChain.eq.mockImplementation(() => taDeleteChain);
  taDeleteChain.in.mockImplementation(() => taDeleteChain);
  tripAgenciesChain.delete.mockReturnValue(taDeleteChain);

  const taInsertChain = createChainable();
  tripAgenciesChain.insert.mockResolvedValue({ error: null });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('updateTrip', () => {
  beforeEach(() => {
    resetTableChains();
  });

  // ─── Basic validation ───────────────────────────────────────────
  describe('basic validation', () => {
    it('rejects when no agencies are provided', async () => {
      setupHappyPath();
      await expect(
        superadminService.updateTrip('trip-1', 'route-1', FUTURE_DATE, 'bus', []),
      ).rejects.toThrow('agency is required');
    });

    it('allows editing an active trip with no activity', async () => {
      setupHappyPath();
      const result = await superadminService.updateTrip(
        'trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1', 'agency-2'],
      );
      expect(result).toBeDefined();
    });
  });

  // ─── Blocked states ─────────────────────────────────────────────
  describe('blocked states', () => {
    it('rejects completed trips', async () => {
      setupHappyPath({ tripOverrides: { status: 'completed' } });
      await expect(
        superadminService.updateTrip('trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1']),
      ).rejects.toThrow('completado');
    });

    it('rejects cancelled trips', async () => {
      setupHappyPath({ tripOverrides: { status: 'cancelled' } });
      await expect(
        superadminService.updateTrip('trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1']),
      ).rejects.toThrow('cancelado');
    });

    it('rejects trips with past departure time', async () => {
      setupHappyPath({ tripOverrides: { departure_time: PAST_DATE } });
      await expect(
        superadminService.updateTrip('trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1']),
      ).rejects.toThrow('hora de salida ya pasó');
    });

    it('rejects trips with boarded passengers', async () => {
      setupHappyPath({
        boardedCount: 3,
        allReservations: [{ id: 'res-1' }, { id: 'res-2' }, { id: 'res-3' }],
      });
      await expect(
        superadminService.updateTrip('trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1']),
      ).rejects.toThrow('3 pasajero(s) ya abordado(s)');
    });

    it('rejects editing a trip with active reservations (non-postpone)', async () => {
      setupHappyPath({
        activeReservations: [
          { id: 'res-1', agency_id: 'agency-1' },
          { id: 'res-2', agency_id: 'agency-2' },
        ],
      });
      await expect(
        superadminService.updateTrip('trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1', 'agency-2']),
      ).rejects.toThrow('reservas activas');
    });

    it('allows postpone when active reservations exist', async () => {
      setupHappyPath({
        activeReservations: [
          { id: 'res-1', agency_id: 'agency-1' },
        ],
      });
      const result = await superadminService.updateTrip(
        'trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1'], true,
      );
      expect(result).toBeDefined();
    });
  });

  // ─── Vehicle change ─────────────────────────────────────────────
  describe('vehicle change validation', () => {
    it('allows changing from bus to kia when no activity', async () => {
      setupHappyPath();
      const result = await superadminService.updateTrip(
        'trip-1', 'route-1', FUTURE_DATE, 'kia', ['agency-1'],
      );
      expect(result).toBeDefined();
    });

    it('blocks vehicle change when active reservations exist', async () => {
      setupHappyPath({
        activeReservations: [
          { id: 'res-1', agency_id: 'agency-1' },
          { id: 'res-2', agency_id: 'agency-1' },
        ],
      });
      await expect(
        superadminService.updateTrip('trip-1', 'route-1', FUTURE_DATE, 'kia', ['agency-1']),
      ).rejects.toThrow('reservas activas');
    });

    it('blocks vehicle change when locks exist', async () => {
      setupHappyPath({ lockedCount: 4 });
      await expect(
        superadminService.updateTrip('trip-1', 'route-1', FUTURE_DATE, 'kia', ['agency-1']),
      ).rejects.toThrow('asiento(s) bloqueado(s)');
    });

    it('allows keeping same vehicle type even with locked seats', async () => {
      setupHappyPath({
        lockedCount: 4,
      });
      const result = await superadminService.updateTrip(
        'trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1'],
      );
      expect(result).toBeDefined();
    });
  });

  // ─── Agency removal ─────────────────────────────────────────────
  describe('agency removal validation', () => {
    it('allows removing an agency without active reservations', async () => {
      setupHappyPath();
      const result = await superadminService.updateTrip(
        'trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1'],
      );
      expect(result).toBeDefined();
    });

    it('blocks removing an agency with active reservations', async () => {
      setupHappyPath({
        activeReservations: [{ id: 'res-1', agency_id: 'agency-2' }],
      });
      await expect(
        superadminService.updateTrip('trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1']),
      ).rejects.toThrow('reservas activas');
    });

    it('allows removing an agency when no active reservations exist', async () => {
      setupHappyPath({
        activeReservations: [],
      });
      const result = await superadminService.updateTrip(
        'trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1'],
      );
      expect(result).toBeDefined();
    });

    it('allows adding new agencies', async () => {
      const trips = buildTableChain('trips');
      trips.single
        .mockResolvedValueOnce({ data: makeTripRow(), error: null })
        .mockResolvedValueOnce({
          data: {
            ...makeTripRow(),
            routes: { origin: 'Caracas', destination: 'Maracaibo' },
            trip_agencies: [
              { agency_id: 'agency-1' },
              { agency_id: 'agency-2' },
              { agency_id: 'agency-3' },
            ],
          },
          error: null,
        });

      const updateChain = createChainable();
      updateChain.eq.mockImplementation(() => ({
        then: (resolve: any) => resolve({ error: null }),
      }));
      trips.update.mockReturnValue(updateChain);

      const reservations = buildTableChain('reservations');
      reservations.then.mockImplementation((resolve: any) => {
        resolve({ data: [], error: null });
      });

      const seats = buildTableChain('seats');
      seats.then.mockImplementation((resolve: any) => {
        resolve({ data: null, error: null, count: 0 });
      });

      const rp = buildTableChain('reservation_passengers');
      rp.then.mockImplementation((resolve: any) => {
        resolve({ data: null, error: null, count: 0 });
      });

      const tripAgenciesChain = buildTableChain('trip_agencies');
      tripAgenciesChain.then.mockImplementation((resolve: any) => {
        resolve({ data: [{ agency_id: 'agency-1' }, { agency_id: 'agency-2' }], error: null });
      });
      tripAgenciesChain.insert.mockResolvedValue({ error: null });

      const result = await superadminService.updateTrip(
        'trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1', 'agency-2', 'agency-3'],
      );
      expect(result).toBeDefined();
    });
  });

  // ─── Capacity changes ───────────────────────────────────────────
  describe('seat capacity changes', () => {
    it('adds new seats when capacity increases', async () => {
      setupHappyPath({ tripOverrides: { capacity: 10, vehicle_type: 'kia' } });
      const seats = buildTableChain('seats');
      seats.insert.mockResolvedValue({ error: null });

      await superadminService.updateTrip(
        'trip-1', 'route-1', FUTURE_DATE, 'bus', ['agency-1'],
      );
      expect(seats.insert).toHaveBeenCalled();
    });

    it('blocks reducing capacity when reserved seats exist in excess range', async () => {
      // Setup: trip has 31 capacity, we want kia (10), so excess = A11-A31
      // Some of those have reservations
      setupHappyPath({ tripOverrides: { capacity: 31 } });

      const seats = buildTableChain('seats');

      // Override then for the reserved seats check:
      // First call is lockedCount from context (via .select().eq().eq().then)
      // Second call is the reserved seats check (via .select().eq().in().neq().then)
      let seatsThenCount = 0;
      seats.then.mockImplementation((resolve: any) => {
        seatsThenCount++;
        if (seatsThenCount === 1) {
          // Locked seats from context
          resolve({ data: null, error: null, count: 0 });
        } else {
          // Reserved seats in excess range
          resolve({
            data: [{ seat_code: 'A25' }, { seat_code: 'A26' }],
            error: null,
          });
        }
      });

      await expect(
        superadminService.updateTrip('trip-1', 'route-1', FUTURE_DATE, 'kia', ['agency-1']),
      ).rejects.toThrow('reducir capacidad');
    });
  });
});
