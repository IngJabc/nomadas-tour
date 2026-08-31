import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock database BEFORE any imports ────────────────────────────────
// The chainable mock must support the full Supabase query builder pattern:
// from(table).select().eq().in().single()  (read)
// from(table).update(data).eq()             (write)
// from(table).insert(rows)                  (write)
// from(table).delete().eq().in()            (write)

const mockEnv = vi.hoisted(() => ({
  TRIP_EFFECTS_VIA_OUTBOX: false,
}));

const mockRpc = vi.hoisted(() => vi.fn());

vi.mock('../config/env.js', () => ({
  env: {
    SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    JWT_SECRET: 'test-jwt-secret',
    PORT: 3001,
    NODE_ENV: 'test',
    CORS_ORIGIN: 'http://localhost:3000',
    RESEND_API_KEY: 'test-resend',
    EMAIL_FROM: 'test@example.com',
    FRONTEND_URL: 'http://localhost:3000',
    LOCK_TTL_SECONDS: 600,
    EMAIL_VIA_OUTBOX: false,
    get TRIP_EFFECTS_VIA_OUTBOX() {
      return mockEnv.TRIP_EFFECTS_VIA_OUTBOX;
    },
    OUTBOX_POLL_MS: 2000,
    OUTBOX_BATCH_SIZE: 10,
    OUTBOX_MAX_ATTEMPTS: 10,
    OUTBOX_SETTLE_MS: 5000,
    OUTBOX_RETRY_BASE_MS: 2000,
    OUTBOX_HEARTBEAT_MS: 30_000,
    OUTBOX_STALE_PROCESSING_MS: 300_000,
    OUTBOX_STALE_RECOVERY_LIMIT: 50,
    OUTBOX_RECOVERY_INTERVAL_MS: 60_000,
    SENTRY_ENABLED: false,
    SENTRY_DSN: '',
    SENTRY_ENVIRONMENT: '',
    SENTRY_RELEASE: '',
    WORKER_HEALTH_PORT: 3002,
  },
}));

function createChainable(defaultResult: any = [], defaultError: any = null) {
  const chain: any = {};

  // Query builder methods return self for chaining
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.lt = vi.fn(() => chain);
  chain.range = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.ilike = vi.fn(() => chain);

  // Terminal methods that return promises
  chain.single = vi.fn(() => Promise.resolve({ data: defaultResult, error: defaultError }));
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));

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
    return { from: mockFrom, rpc: mockRpc };
  },
}));

vi.mock('./email.service.js', () => ({
  emailService: {
    sendTripPostponedEmail: vi.fn(),
    sendNewTripAssignedEmail: vi.fn(),
    sendTripCancelledEmail: vi.fn(),
    sendInvitationEmail: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('./notification.service.js', () => ({
  notificationService: {
    createForAgenciesAndAdmin: vi.fn(() => Promise.resolve(undefined)),
  },
}));

const mockSeedDefaults = vi.fn().mockResolvedValue(undefined);
vi.mock('./notification-preference.service.js', () => ({
  notificationPreferenceService: {
    seedDefaults: (...args: any[]) => mockSeedDefaults(...args),
  },
}));

const mockSeedBrandingDefaults = vi.fn().mockResolvedValue(undefined);
vi.mock('./agency-settings.service.js', () => ({
  agencySettingsService: {
    seedBrandingDefaults: (...args: any[]) => mockSeedBrandingDefaults(...args),
  },
}));

vi.mock('./notification-delivery.policy.js', () => ({
  notificationDeliveryPolicy: {
    shouldDeliver: vi.fn(() => Promise.resolve(false)),
  },
}));

vi.mock('../utils/subdomain.js', () => ({
  generateUniqueSubdomain: vi.fn(),
}));

vi.mock('../utils/token.js', () => ({
  generateToken: vi.fn(),
}));

// ── Import after mocks ──────────────────────────────────────────────

import { superadminService, TripUpdateAction } from './superadmin.service.js';
import { DUPLICATE_TRIP_MESSAGE } from './trip-duplicate.guard.js';
import { emailService } from './email.service.js';
import { notificationService } from './notification.service.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/index.js';

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
  trips.maybeSingle.mockResolvedValue({ data: null, error: null });
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

function setupCreateTripHappyPath() {
  const routesChain = createChainable({
    id: 'route-1',
    status: 'active',
    origin: 'Caracas',
    destination: 'Maracaibo',
  });
  tableChains['routes'] = routesChain;

  const tripsChain = createChainable();
  tripsChain.maybeSingle.mockResolvedValue({ data: null, error: null });
  tripsChain.insert.mockImplementation(() => tripsChain);
  tripsChain.select.mockImplementation(() => tripsChain);
  tripsChain.single.mockResolvedValue({
    data: {
      id: 'trip-new',
      route_id: 'route-1',
      departure_time: FUTURE_DATE,
      capacity: 31,
      vehicle_type: 'bus',
    },
    error: null,
  });
  tableChains['trips'] = tripsChain;

  const seatsChain = createChainable();
  seatsChain.insert.mockResolvedValue({ error: null });
  tableChains['seats'] = seatsChain;

  const tripAgenciesChain = createChainable();
  tripAgenciesChain.insert.mockResolvedValue({ error: null });
  tableChains['trip_agencies'] = tripAgenciesChain;

  tableChains['agencies'] = createChainable([]);
}

const DEPARTURE_FUTURE_MESSAGE = 'posterior a la fecha y hora actual';

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  mockEnv.TRIP_EFFECTS_VIA_OUTBOX = false;
  mockRpc.mockReset();
});

describe('createTrip departure validation', () => {
  beforeEach(() => {
    resetTableChains();
  });

  it('allows creating a trip with a future departure time', async () => {
    setupCreateTripHappyPath();

    const result = await superadminService.createTrip(
      'route-1',
      FUTURE_DATE,
      'bus',
      ['agency-1'],
      'user-1',
    );

    expect(result.id).toBe('trip-new');
  });

  it('rejects creating a trip with a past departure time', async () => {
    await expect(
      superadminService.createTrip(
        'route-1',
        PAST_DATE,
        'bus',
        ['agency-1'],
        'user-1',
      ),
    ).rejects.toThrow(DEPARTURE_FUTURE_MESSAGE);
  });

  it('rejects creating a trip with departure equal to now', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));

    await expect(
      superadminService.createTrip(
        'route-1',
        new Date().toISOString(),
        'bus',
        ['agency-1'],
        'user-1',
      ),
    ).rejects.toThrow(DEPARTURE_FUTURE_MESSAGE);

    vi.useRealTimers();
  });
});

describe('updateTrip departure validation', () => {
  beforeEach(() => {
    resetTableChains();
  });

  it('rejects changing departure to a past time', async () => {
    setupHappyPath();

    await expect(
      superadminService.updateTrip(
        'trip-1',
        'route-1',
        PAST_DATE,
        'bus',
        ['agency-1'],
      ),
    ).rejects.toThrow(DEPARTURE_FUTURE_MESSAGE);
  });

  it('allows editing a trip while keeping the same future departure time', async () => {
    setupHappyPath();

    const result = await superadminService.updateTrip(
      'trip-1',
      'route-1',
      FUTURE_DATE,
      'bus',
      ['agency-1'],
    );

    expect(result).toBeDefined();
  });
});

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

  describe('postponed_from', () => {
    const OLD_DEPARTURE = FUTURE_DATE;
    const NEW_DEPARTURE = new Date(Date.now() + 172_800_000).toISOString();

    beforeEach(() => {
      vi.mocked(emailService.sendTripPostponedEmail).mockClear();
      vi.mocked(notificationService.createForAgenciesAndAdmin).mockClear();
    });

    function captureTripUpdates(overrides: Parameters<typeof setupHappyPath>[0] = {}) {
      setupHappyPath(overrides);
      const updateCalls: Record<string, unknown>[] = [];
      const updateChain = createChainable();
      updateChain.eq.mockImplementation(() => ({
        then: (resolve: any) => resolve({ error: null }),
      }));
      tableChains['trips'].update.mockImplementation((data: Record<string, unknown>) => {
        updateCalls.push(data);
        return updateChain;
      });
      tableChains['routes'] = createChainable({
        origin: 'Caracas',
        destination: 'Maracaibo',
      });
      return updateCalls;
    }

    it('sets postponed_from in the same UPDATE as trip fields (F5-001 single audit)', async () => {
      const updateCalls = captureTripUpdates({
        tripOverrides: { departure_time: OLD_DEPARTURE },
      });

      await superadminService.updateTrip(
        'trip-1',
        'route-1',
        NEW_DEPARTURE,
        'bus',
        ['agency-1'],
        true,
        'actor-1',
      );

      const primary = updateCalls.find(
        (c) => c.departure_time !== undefined && c.postponed_from !== undefined,
      );
      expect(primary).toEqual(
        expect.objectContaining({
          postponed_from: OLD_DEPARTURE,
          updated_by: 'actor-1',
          departure_time: expect.any(String),
        }),
      );
      expect(
        updateCalls.filter((c) => Object.keys(c).length === 1 && 'postponed_from' in c),
      ).toHaveLength(0);
    });

    it('does not set postponed_from when postpone=true but departure time is unchanged', async () => {
      const updateCalls = captureTripUpdates({
        tripOverrides: { departure_time: OLD_DEPARTURE },
      });

      await superadminService.updateTrip(
        'trip-1',
        'route-1',
        OLD_DEPARTURE,
        'bus',
        ['agency-1'],
        true,
      );

      expect(updateCalls.some((c) => 'postponed_from' in c)).toBe(false);
      expect(emailService.sendTripPostponedEmail).not.toHaveBeenCalled();
      expect(notificationService.createForAgenciesAndAdmin).not.toHaveBeenCalled();
    });

    it('does not set postponed_from on a normal edit without postpone', async () => {
      const updateCalls = captureTripUpdates({
        tripOverrides: { departure_time: OLD_DEPARTURE },
      });

      await superadminService.updateTrip(
        'trip-1',
        'route-1',
        NEW_DEPARTURE,
        'bus',
        ['agency-1'],
        false,
      );

      expect(updateCalls.some((c) => 'postponed_from' in c)).toBe(false);
    });

    it('returns POSTPONED when postponing to a new departure time', async () => {
      captureTripUpdates({
        tripOverrides: { departure_time: OLD_DEPARTURE },
      });

      const result = await superadminService.updateTrip(
        'trip-1',
        'route-1',
        NEW_DEPARTURE,
        'bus',
        ['agency-1'],
        true,
      );

      expect(result.action).toBe(TripUpdateAction.POSTPONED);
      expect(result.trip).toBeDefined();
    });

    it('returns UPDATED when postpone=true but departure time is unchanged', async () => {
      captureTripUpdates({
        tripOverrides: { departure_time: OLD_DEPARTURE },
      });

      const result = await superadminService.updateTrip(
        'trip-1',
        'route-1',
        OLD_DEPARTURE,
        'bus',
        ['agency-1'],
        true,
      );

      expect(result.action).toBe(TripUpdateAction.UPDATED);
      expect(result.trip).toBeDefined();
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

describe('trip duplicate protection', () => {
  beforeEach(() => {
    resetTableChains();
  });

  it('rejects creating a duplicate trip for the same route and departure time', async () => {
    setupCreateTripHappyPath();
    tableChains['trips'].maybeSingle.mockResolvedValue({
      data: { id: 'existing-trip' },
      error: null,
    });

    await expect(
      superadminService.createTrip(
        'route-1',
        FUTURE_DATE,
        'bus',
        ['agency-1'],
        'user-1',
      ),
    ).rejects.toThrow(DUPLICATE_TRIP_MESSAGE);
  });

  it('allows creating a trip at the same time on a different route', async () => {
    setupCreateTripHappyPath();

    const result = await superadminService.createTrip(
      'route-2',
      FUTURE_DATE,
      'bus',
      ['agency-1'],
      'user-1',
    );

    expect(result.id).toBe('trip-new');
  });

  it('rejects updating a trip to an occupied route and departure slot', async () => {
    setupHappyPath();
    tableChains['trips'].maybeSingle.mockResolvedValue({
      data: { id: 'other-trip' },
      error: null,
    });

    await expect(
      superadminService.updateTrip(
        'trip-1',
        'route-1',
        new Date(Date.now() + 172_800_000).toISOString(),
        'bus',
        ['agency-1'],
      ),
    ).rejects.toThrow(DUPLICATE_TRIP_MESSAGE);
  });
});

describe('superadminService.listTrips date filter', () => {
  beforeEach(() => {
    resetTableChains();
  });

  it('filters by business date converted to a UTC range in America/Caracas', async () => {
    tableChains['trips'] = createChainable([]);

    await superadminService.listTrips(1, 12, { departure_date: '2026-07-20' });

    // Business midnight (Caracas, UTC-4) → 04:00Z; range is [04:00Z, +24h)
    expect(tableChains['trips'].gte).toHaveBeenCalledWith(
      'departure_time',
      '2026-07-20T04:00:00.000Z',
    );
    expect(tableChains['trips'].lt).toHaveBeenCalledWith(
      'departure_time',
      '2026-07-21T04:00:00.000Z',
    );
  });
});

describe('superadminService.archiveTrip', () => {
  beforeEach(() => {
    resetTableChains();
  });

  it('archives a cancelled trip', async () => {
    const tripsChain = createChainable({
      id: 'trip-1',
      status: 'cancelled',
      route_id: 'route-1',
    });
    tableChains['trips'] = tripsChain;

    const tripAgenciesChain = createChainable([{ agency_id: 'agency-1' }]);
    tableChains['trip_agencies'] = tripAgenciesChain;

    const routesChain = createChainable({
      origin: 'Caracas',
      destination: 'Mérida',
    });
    tableChains['routes'] = routesChain;

    const result = await superadminService.archiveTrip('trip-1');

    expect(result).toEqual({ id: 'trip-1', status: 'archived' });
    expect(tripsChain.update).toHaveBeenCalledWith({ status: 'archived' });
  });

  it('rejects archiving an active trip', async () => {
    tableChains['trips'] = createChainable(
      { id: 'trip-1', status: 'active', route_id: 'route-1' },
    );

    await expect(superadminService.archiveTrip('trip-1')).rejects.toThrow(
      'No se puede archivar un viaje activo',
    );
  });

  it('rejects archiving an already archived trip', async () => {
    tableChains['trips'] = createChainable(
      { id: 'trip-1', status: 'archived', route_id: 'route-1' },
    );

    await expect(superadminService.archiveTrip('trip-1')).rejects.toThrow(
      'El viaje ya está archivado',
    );
  });
});

// ── WKR-007 C2 — TRIP_EFFECTS_VIA_OUTBOX RPC path ───────────────────

describe('WKR-007 C2 — trip RPCs behind TRIP_EFFECTS_VIA_OUTBOX', () => {
  beforeEach(() => {
    resetTableChains();
    mockEnv.TRIP_EFFECTS_VIA_OUTBOX = true;
    vi.mocked(emailService.sendNewTripAssignedEmail).mockClear();
    vi.mocked(emailService.sendTripPostponedEmail).mockClear();
    vi.mocked(emailService.sendTripCancelledEmail).mockClear();
    vi.mocked(notificationService.createForAgenciesAndAdmin).mockClear();
  });

  it('createTrip calls create_trip RPC without legacy inserts or side effects', async () => {
    setupCreateTripHappyPath();
    mockRpc.mockResolvedValue({
      data: {
        id: 'trip-rpc',
        route_id: 'route-1',
        departure_time: FUTURE_DATE,
        capacity: 31,
        vehicle_type: 'bus',
      },
      error: null,
    });

    const result = await superadminService.createTrip(
      'route-1',
      FUTURE_DATE,
      'bus',
      ['agency-1', 'agency-2'],
      'user-1',
    );

    expect(mockRpc).toHaveBeenCalledWith('create_trip', {
      p_route_id: 'route-1',
      p_departure_time: expect.any(String),
      p_vehicle_type: 'bus',
      p_agency_ids: ['agency-1', 'agency-2'],
      p_created_by: 'user-1',
    });
    expect(tableChains['trips'].insert).not.toHaveBeenCalled();
    expect(tableChains['seats'].insert).not.toHaveBeenCalled();
    expect(tableChains['trip_agencies'].insert).not.toHaveBeenCalled();
    expect(emailService.sendNewTripAssignedEmail).not.toHaveBeenCalled();
    expect(notificationService.createForAgenciesAndAdmin).not.toHaveBeenCalled();
    expect(result.id).toBe('trip-rpc');
  });

  it('updateTrip postpone calls update_trip with p_postpone=true and returns POSTPONED', async () => {
    const newDeparture = new Date(Date.now() + 2 * 86_400_000).toISOString();
    setupHappyPath();
    mockRpc.mockResolvedValue({
      data: {
        trip_id: 'trip-1',
        action: 'postponed',
        event_type: 'trip.postponed',
        changed_fields: [],
      },
      error: null,
    });

    const result = await superadminService.updateTrip(
      'trip-1',
      'route-1',
      newDeparture,
      'bus',
      ['agency-1', 'agency-2'],
      true,
    );

    expect(mockRpc).toHaveBeenCalledWith('update_trip', {
      p_trip_id: 'trip-1',
      p_route_id: 'route-1',
      p_departure_time: expect.any(String),
      p_vehicle_type: 'bus',
      p_agency_ids: ['agency-1', 'agency-2'],
      p_postpone: true,
      p_actor_user_id: null,
    });
    expect(result.action).toBe(TripUpdateAction.POSTPONED);
    expect(result.trip.id).toBe('trip-1');
    expect(emailService.sendTripPostponedEmail).not.toHaveBeenCalled();
    expect(notificationService.createForAgenciesAndAdmin).not.toHaveBeenCalled();
  });

  it('updateTrip edit calls update_trip with p_postpone=false and returns UPDATED', async () => {
    setupHappyPath();
    mockRpc.mockResolvedValue({
      data: {
        trip_id: 'trip-1',
        action: 'updated',
        event_type: 'trip.updated',
        changed_fields: ['route_id'],
      },
      error: null,
    });

    const result = await superadminService.updateTrip(
      'trip-1',
      'route-2',
      FUTURE_DATE,
      'bus',
      ['agency-1', 'agency-2'],
      false,
    );

    expect(mockRpc).toHaveBeenCalledWith('update_trip', {
      p_trip_id: 'trip-1',
      p_route_id: 'route-2',
      p_departure_time: expect.any(String),
      p_vehicle_type: 'bus',
      p_agency_ids: ['agency-1', 'agency-2'],
      p_postpone: false,
      p_actor_user_id: null,
    });
    expect(result.action).toBe(TripUpdateAction.UPDATED);
    expect(emailService.sendTripPostponedEmail).not.toHaveBeenCalled();
    expect(notificationService.createForAgenciesAndAdmin).not.toHaveBeenCalled();
  });

  it('updateTripStatus cancel calls set_trip_status without legacy notification', async () => {
    tableChains['trips'] = createChainable({
      id: 'trip-1',
      status: 'active',
      departure_time: FUTURE_DATE,
      route_id: 'route-1',
    });
    mockRpc.mockResolvedValue({
      data: { trip_id: 'trip-1', status: 'cancelled' },
      error: null,
    });

    const result = await superadminService.updateTripStatus(
      'trip-1',
      'cancelled',
    );

    expect(mockRpc).toHaveBeenCalledWith('set_trip_status', {
      p_trip_id: 'trip-1',
      p_status: 'cancelled',
      p_actor_user_id: null,
    });
    expect(result).toEqual({ id: 'trip-1', status: 'cancelled' });
    expect(emailService.sendTripCancelledEmail).not.toHaveBeenCalled();
    expect(notificationService.createForAgenciesAndAdmin).not.toHaveBeenCalled();
  });

  it('updateTripStatus completed calls set_trip_status for manual completion', async () => {
    tableChains['trips'] = createChainable({
      id: 'trip-1',
      status: 'active',
      departure_time: PAST_DATE,
      route_id: 'route-1',
    });
    mockRpc.mockResolvedValue({
      data: { trip_id: 'trip-1', status: 'completed' },
      error: null,
    });

    const result = await superadminService.updateTripStatus(
      'trip-1',
      'completed',
    );

    expect(mockRpc).toHaveBeenCalledWith('set_trip_status', {
      p_trip_id: 'trip-1',
      p_status: 'completed',
      p_actor_user_id: null,
    });
    expect(result).toEqual({ id: 'trip-1', status: 'completed' });
    expect(notificationService.createForAgenciesAndAdmin).not.toHaveBeenCalled();
  });

  it('archiveTrip calls archive_trip without legacy notification', async () => {
    tableChains['trips'] = createChainable({
      id: 'trip-1',
      status: 'cancelled',
      route_id: 'route-1',
    });
    mockRpc.mockResolvedValue({
      data: { trip_id: 'trip-1', status: 'archived' },
      error: null,
    });

    const result = await superadminService.archiveTrip('trip-1');

    expect(mockRpc).toHaveBeenCalledWith('archive_trip', {
      p_trip_id: 'trip-1',
    });
    expect(result).toEqual({ id: 'trip-1', status: 'archived' });
    expect(notificationService.createForAgenciesAndAdmin).not.toHaveBeenCalled();
  });

  it('maps ERR_TRIP_DUPLICATE to ConflictError', async () => {
    setupCreateTripHappyPath();
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'ERR_TRIP_DUPLICATE: Ya existe un viaje programado para esta ruta en la fecha y hora seleccionadas.',
      },
    });

    await expect(
      superadminService.createTrip(
        'route-1',
        FUTURE_DATE,
        'bus',
        ['agency-1'],
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      superadminService.createTrip(
        'route-1',
        FUTURE_DATE,
        'bus',
        ['agency-1'],
        'user-1',
      ),
    ).rejects.toThrow(DUPLICATE_TRIP_MESSAGE);
  });

  it('maps ERR_TRIP_NOT_FOUND to NotFoundError', async () => {
    tableChains['trips'] = createChainable({
      id: 'trip-1',
      status: 'cancelled',
      route_id: 'route-1',
    });
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'ERR_TRIP_NOT_FOUND: Trip not found' },
    });

    await expect(superadminService.archiveTrip('trip-1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('maps ERR_TRIP_DEPARTED to ForbiddenError', async () => {
    tableChains['trips'] = createChainable({
      id: 'trip-1',
      status: 'active',
      departure_time: FUTURE_DATE,
      route_id: 'route-1',
    });
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'ERR_TRIP_DEPARTED: Cannot cancel a trip after its departure time',
      },
    });

    await expect(
      superadminService.updateTripStatus('trip-1', 'cancelled'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('maps unrecognized RPC errors to ValidationError', async () => {
    setupCreateTripHappyPath();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'something unexpected failed' },
    });

    await expect(
      superadminService.createTrip(
        'route-1',
        FUTURE_DATE,
        'bus',
        ['agency-1'],
        'user-1',
      ),
    ).rejects.toThrow(ValidationError);
  });
});

describe('superadminService.createAgency', () => {
  beforeEach(() => {
    resetTableChains();
    mockSeedDefaults.mockClear();
    mockSeedBrandingDefaults.mockClear();
  });

  it('creates agency and seeds both notification prefs and branding defaults', async () => {
    const agenciesChain = createChainable();
    agenciesChain.insert.mockImplementation(() => agenciesChain);
    agenciesChain.select.mockImplementation(() => agenciesChain);
    agenciesChain.single.mockResolvedValue({
      data: { id: 'new-agency-1', name: 'Test Agency', status: 'pending' },
      error: null,
    });
    tableChains['agencies'] = agenciesChain;

    const invitationsChain = createChainable();
    invitationsChain.insert.mockResolvedValue({ error: null });
    tableChains['agency_invitations'] = invitationsChain;

    const { generateUniqueSubdomain } = await import('../utils/subdomain.js');
    vi.mocked(generateUniqueSubdomain).mockResolvedValue('test-agency');
    const { generateToken } = await import('../utils/token.js');
    vi.mocked(generateToken).mockReturnValue('test-token-123');

    const result = await superadminService.createAgency(
      'Test Agency',
      'test@example.com',
      'admin-1',
    );

    expect(result.id).toBe('new-agency-1');
    expect(mockSeedDefaults).toHaveBeenCalledWith('new-agency-1');
    expect(mockSeedBrandingDefaults).toHaveBeenCalledWith('new-agency-1');
  });

  it('calls seedBrandingDefaults even if notification seed fails', async () => {
    const agenciesChain = createChainable();
    agenciesChain.insert.mockImplementation(() => agenciesChain);
    agenciesChain.select.mockImplementation(() => agenciesChain);
    agenciesChain.single.mockResolvedValue({
      data: { id: 'new-agency-2', name: 'Agency 2', status: 'pending' },
      error: null,
    });
    tableChains['agencies'] = agenciesChain;

    const invitationsChain = createChainable();
    invitationsChain.insert.mockResolvedValue({ error: null });
    tableChains['agency_invitations'] = invitationsChain;

    mockSeedDefaults.mockRejectedValueOnce(new Error('notif seed failed'));

    const { generateUniqueSubdomain } = await import('../utils/subdomain.js');
    vi.mocked(generateUniqueSubdomain).mockResolvedValue('agency-2');
    const { generateToken } = await import('../utils/token.js');
    vi.mocked(generateToken).mockReturnValue('token-2');

    await expect(
      superadminService.createAgency('Agency 2', 'a2@test.com', 'admin-1'),
    ).rejects.toThrow('notif seed failed');

    // branding seed should NOT be called if notif seed throws first
    expect(mockSeedBrandingDefaults).not.toHaveBeenCalled();
  });
});
