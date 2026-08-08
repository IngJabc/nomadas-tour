import { describe, it, expect, vi, beforeEach } from 'vitest';

function createChainable(defaultResult: any = [], defaultError: any = null) {
  const chain: any = {};

  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.lt = vi.fn(() => chain);
  chain.range = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.ilike = vi.fn(() => chain);

  chain.single = vi.fn(() =>
    Promise.resolve({ data: defaultResult, error: defaultError }),
  );
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));

  chain.update = vi.fn((_data?: any) => {
    const updateChain = createChainable();
    return updateChain;
  });

  chain.insert = vi.fn((_rows?: any) => {
    return Promise.resolve({ error: null, data: null });
  });

  chain.delete = vi.fn(() => {
    const deleteChain = createChainable();
    return deleteChain;
  });

  chain.then = vi.fn((resolve: any) => {
    const arr = Array.isArray(defaultResult)
      ? defaultResult
      : defaultResult
        ? [defaultResult]
        : [];
    resolve({ data: defaultResult, error: defaultError, count: arr.length });
  });

  return chain;
}

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
    sendTripPostponedEmail: vi.fn(() => Promise.resolve({ ok: true })),
    sendNewTripAssignedEmail: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

vi.mock('./notification.service.js', () => ({
  notificationService: {
    createForAgenciesAndAdmin: vi.fn(() => Promise.resolve(undefined)),
  },
}));

vi.mock('./notification-delivery.policy.js', () => ({
  notificationDeliveryPolicy: {
    shouldDeliver: vi.fn(() => Promise.resolve(true)),
  },
}));

vi.mock('../utils/subdomain.js', () => ({
  generateUniqueSubdomain: vi.fn(),
}));

vi.mock('../utils/token.js', () => ({
  generateToken: vi.fn(),
}));

import { superadminService } from './superadmin.service.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/index.js';
import { emailService } from './email.service.js';
import { notificationService } from './notification.service.js';
import { notificationDeliveryPolicy } from './notification-delivery.policy.js';

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

function setupAddAgencyContext(overrides: {
  tripOverrides?: Record<string, any>;
  activeReservations?: any[];
  boardedCount?: number;
  currentAgencies?: { agency_id: string }[];
  allReservations?: any[];
  agencies?: { id: string; name: string; status: string; email: string | null }[];
  insertError?: { code?: string; message: string } | null;
} = {}) {
  const {
    tripOverrides = {},
    activeReservations = [],
    boardedCount = 0,
    currentAgencies = [{ agency_id: 'agency-1' }],
    allReservations = [],
    agencies = [
      {
        id: 'agency-2',
        name: 'Agency Two',
        status: 'active',
        email: 'a2@example.com',
      },
    ],
    insertError = null,
  } = overrides;

  const trips = buildTableChain('trips');
  trips.single.mockResolvedValue({
    data: makeTripRow(tripOverrides),
    error: null,
  });
  trips.update.mockImplementation(() => {
    const updateChain = createChainable();
    updateChain.eq.mockImplementation(() => ({
      then: (resolve: any) => resolve({ error: null }),
    }));
    return updateChain;
  });

  const reservations = buildTableChain('reservations');
  let resCallCount = 0;
  reservations.then.mockImplementation((resolve: any) => {
    resCallCount++;
    if (resCallCount === 1) {
      resolve({
        data: activeReservations,
        error: null,
        count: activeReservations.length,
      });
    } else {
      resolve({
        data: allReservations,
        error: null,
        count: allReservations.length,
      });
    }
  });
  reservations.update = vi.fn(() => createChainable());

  const seats = buildTableChain('seats');
  seats.then.mockImplementation((resolve: any) => {
    resolve({ data: null, error: null, count: 0 });
  });
  seats.update = vi.fn(() => createChainable());
  seats.insert = vi.fn(() => Promise.resolve({ error: null }));
  seats.delete = vi.fn(() => createChainable());

  const tripAgencies = buildTableChain('trip_agencies');
  tripAgencies.then.mockImplementation((resolve: any) => {
    resolve({ data: currentAgencies, error: null });
  });
  tripAgencies.insert = vi.fn((_rows?: any) =>
    Promise.resolve({ error: insertError, data: null }),
  );

  const rp = buildTableChain('reservation_passengers');
  rp.then.mockImplementation((resolve: any) => {
    resolve({ data: null, error: null, count: boardedCount });
  });
  rp.update = vi.fn(() => createChainable());

  const agenciesChain = buildTableChain('agencies');
  agenciesChain.then.mockImplementation((resolve: any) => {
    resolve({ data: agencies, error: null, count: agencies.length });
  });

  const routes = buildTableChain('routes');
  routes.single.mockResolvedValue({
    data: { origin: 'Caracas', destination: 'Maracaibo' },
    error: null,
  });

  return { tripAgencies, trips, seats, reservations, rp, agenciesChain };
}

describe('addAgenciesToTrip', () => {
  beforeEach(() => {
    resetTableChains();
    vi.mocked(emailService.sendNewTripAssignedEmail).mockClear();
    vi.mocked(emailService.sendNewTripAssignedEmail).mockResolvedValue({
      ok: true,
    } as any);
    vi.mocked(notificationService.createForAgenciesAndAdmin).mockClear();
    vi.mocked(notificationService.createForAgenciesAndAdmin).mockResolvedValue(
      undefined as any,
    );
    vi.mocked(notificationDeliveryPolicy.shouldDeliver).mockClear();
    vi.mocked(notificationDeliveryPolicy.shouldDeliver).mockResolvedValue(true);
  });

  it('adds an active agency to a trip without reservations', async () => {
    const { tripAgencies } = setupAddAgencyContext();
    const result = await superadminService.addAgenciesToTrip('trip-1', [
      'agency-2',
    ]);
    expect(result.added_agency_ids).toEqual(['agency-2']);
    expect(tripAgencies.insert).toHaveBeenCalledWith([
      { trip_id: 'trip-1', agency_id: 'agency-2' },
    ]);
  });

  it('adds an active agency to a trip WITH active reservations', async () => {
    const { tripAgencies } = setupAddAgencyContext({
      activeReservations: [{ id: 'res-1', agency_id: 'agency-1' }],
    });
    const result = await superadminService.addAgenciesToTrip('trip-1', [
      'agency-2',
    ]);
    expect(result.added_agency_ids).toEqual(['agency-2']);
    expect(tripAgencies.insert).toHaveBeenCalled();
  });

  it('inserts into trip_agencies only and does not mutate trips/seats/reservations/passengers', async () => {
    const { tripAgencies, trips, seats, reservations, rp } =
      setupAddAgencyContext({
        activeReservations: [{ id: 'res-1', agency_id: 'agency-1' }],
      });

    await superadminService.addAgenciesToTrip('trip-1', ['agency-2']);

    expect(tripAgencies.insert).toHaveBeenCalledTimes(1);
    expect(trips.update).not.toHaveBeenCalled();
    expect(seats.update).not.toHaveBeenCalled();
    expect(seats.insert).not.toHaveBeenCalled();
    expect(seats.delete).not.toHaveBeenCalled();
    expect(reservations.update).not.toHaveBeenCalled();
    expect(rp.update).not.toHaveBeenCalled();
  });

  it('rejects pending agency', async () => {
    setupAddAgencyContext({
      agencies: [
        {
          id: 'agency-2',
          name: 'Pending Co',
          status: 'pending',
          email: 'p@example.com',
        },
      ],
    });
    await expect(
      superadminService.addAgenciesToTrip('trip-1', ['agency-2']),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ValidationError && /pendiente/i.test(err.message),
    );
  });

  it('rejects inactive agency', async () => {
    setupAddAgencyContext({
      agencies: [
        {
          id: 'agency-2',
          name: 'Inactive Co',
          status: 'inactive',
          email: 'i@example.com',
        },
      ],
    });
    await expect(
      superadminService.addAgenciesToTrip('trip-1', ['agency-2']),
    ).rejects.toThrow('inactiva');
  });

  it('rejects missing agency with NotFoundError', async () => {
    setupAddAgencyContext({ agencies: [] });
    await expect(
      superadminService.addAgenciesToTrip('trip-1', ['agency-missing']),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects cancelled trip', async () => {
    setupAddAgencyContext({ tripOverrides: { status: 'cancelled' } });
    await expect(
      superadminService.addAgenciesToTrip('trip-1', ['agency-2']),
    ).rejects.toThrow('cancelado');
  });

  it('rejects completed trip', async () => {
    setupAddAgencyContext({ tripOverrides: { status: 'completed' } });
    await expect(
      superadminService.addAgenciesToTrip('trip-1', ['agency-2']),
    ).rejects.toThrow('completado');
  });

  it('rejects archived trip', async () => {
    setupAddAgencyContext({ tripOverrides: { status: 'archived' } });
    await expect(
      superadminService.addAgenciesToTrip('trip-1', ['agency-2']),
    ).rejects.toThrow('archivado');
  });

  it('rejects trip with past departure', async () => {
    setupAddAgencyContext({
      tripOverrides: { departure_time: PAST_DATE },
    });
    await expect(
      superadminService.addAgenciesToTrip('trip-1', ['agency-2']),
    ).rejects.toThrow('hora de salida ya pasó');
  });

  it('rejects trip with boarded passengers', async () => {
    setupAddAgencyContext({
      boardedCount: 2,
      allReservations: [{ id: 'res-1' }],
    });
    await expect(
      superadminService.addAgenciesToTrip('trip-1', ['agency-2']),
    ).rejects.toThrow('abordado');
  });

  it('rejects already associated agency with ConflictError', async () => {
    setupAddAgencyContext({
      currentAgencies: [{ agency_id: 'agency-1' }, { agency_id: 'agency-2' }],
      agencies: [
        {
          id: 'agency-2',
          name: 'Agency Two',
          status: 'active',
          email: 'a2@example.com',
        },
      ],
    });
    await expect(
      superadminService.addAgenciesToTrip('trip-1', ['agency-2']),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('deduplicates agency_ids in the request to a single insert row', async () => {
    const { tripAgencies } = setupAddAgencyContext();
    await superadminService.addAgenciesToTrip('trip-1', [
      'agency-2',
      'agency-2',
    ]);
    expect(tripAgencies.insert).toHaveBeenCalledWith([
      { trip_id: 'trip-1', agency_id: 'agency-2' },
    ]);
  });

  it('maps concurrent unique violation to ConflictError', async () => {
    setupAddAgencyContext({
      insertError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      },
    });
    await expect(
      superadminService.addAgenciesToTrip('trip-1', ['agency-2']),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('sends email and notification only for newly added agencies', async () => {
    setupAddAgencyContext({
      currentAgencies: [{ agency_id: 'agency-1' }],
      agencies: [
        {
          id: 'agency-2',
          name: 'Agency Two',
          status: 'active',
          email: 'a2@example.com',
        },
      ],
    });

    await superadminService.addAgenciesToTrip('trip-1', ['agency-2']);

    // allow microtasks for fire-and-forget
    await Promise.resolve();

    expect(emailService.sendNewTripAssignedEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendNewTripAssignedEmail).toHaveBeenCalledWith(
      'a2@example.com',
      'Agency Two',
      'Caracas',
      'Maracaibo',
      expect.any(String),
      'bus',
      31,
      'trip-1',
      'agency-2',
    );
    expect(notificationService.createForAgenciesAndAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trip_created',
        agencyIds: ['agency-2'],
        entityId: 'trip-1',
      }),
    );
  });

  it('keeps assignment successful when email/notification fail', async () => {
    vi.mocked(emailService.sendNewTripAssignedEmail).mockRejectedValue(
      new Error('resend down'),
    );
    vi.mocked(notificationService.createForAgenciesAndAdmin).mockRejectedValue(
      new Error('notif down'),
    );

    const { tripAgencies } = setupAddAgencyContext();
    const result = await superadminService.addAgenciesToTrip('trip-1', [
      'agency-2',
    ]);

    expect(result.added_agency_ids).toEqual(['agency-2']);
    expect(tripAgencies.insert).toHaveBeenCalled();

    await Promise.resolve();
  });
});

describe('addAgenciesToTrip regressions vs updateTrip', () => {
  beforeEach(() => {
    resetTableChains();
  });

  function setupUpdateHappyPath(overrides: {
    tripOverrides?: Record<string, any>;
    activeReservations?: any[];
    currentAgencies?: any[];
    allReservations?: any[];
    boardedCount?: number;
  } = {}) {
    const {
      tripOverrides = {},
      activeReservations = [],
      currentAgencies = [{ agency_id: 'agency-1' }, { agency_id: 'agency-2' }],
      allReservations = [],
      boardedCount = 0,
    } = overrides;

    const trips = buildTableChain('trips');
    trips.maybeSingle.mockResolvedValue({ data: null, error: null });
    trips.single
      .mockResolvedValueOnce({ data: makeTripRow(tripOverrides), error: null })
      .mockResolvedValueOnce({
        data: {
          ...makeTripRow(tripOverrides),
          routes: { origin: 'Caracas', destination: 'Maracaibo' },
          trip_agencies: currentAgencies,
        },
        error: null,
      });
    const updateChain = createChainable();
    updateChain.eq.mockImplementation(() => ({
      then: (resolve: any) => resolve({ error: null }),
    }));
    trips.update.mockReturnValue(updateChain);

    const reservations = buildTableChain('reservations');
    let resCallCount = 0;
    reservations.then.mockImplementation((resolve: any) => {
      resCallCount++;
      if (resCallCount === 1) {
        resolve({
          data: activeReservations,
          error: null,
          count: activeReservations.length,
        });
      } else {
        resolve({
          data: allReservations,
          error: null,
          count: allReservations.length,
        });
      }
    });

    const seats = buildTableChain('seats');
    seats.then.mockImplementation((resolve: any) => {
      resolve({ data: null, error: null, count: 0 });
    });
    seats.insert.mockResolvedValue({ error: null });
    const deleteChain = createChainable();
    deleteChain.eq.mockImplementation(() => deleteChain);
    deleteChain.in.mockImplementation(() => deleteChain);
    seats.delete.mockReturnValue(deleteChain);

    const tripAgencies = buildTableChain('trip_agencies');
    tripAgencies.then.mockImplementation((resolve: any) => {
      resolve({ data: currentAgencies, error: null });
    });
    tripAgencies.insert.mockResolvedValue({ error: null });
    const taDelete = createChainable();
    taDelete.eq.mockImplementation(() => taDelete);
    taDelete.in.mockImplementation(() => taDelete);
    tripAgencies.delete.mockReturnValue(taDelete);

    const rp = buildTableChain('reservation_passengers');
    rp.then.mockImplementation((resolve: any) => {
      resolve({ data: null, error: null, count: boardedCount });
    });

    buildTableChain('agencies').then.mockImplementation((resolve: any) => {
      resolve({ data: [], error: null, count: 0 });
    });
    buildTableChain('routes').single.mockResolvedValue({
      data: { origin: 'Caracas', destination: 'Maracaibo' },
      error: null,
    });
  }

  it('updateTrip with active reservations still returns ConflictError', async () => {
    setupUpdateHappyPath({
      activeReservations: [{ id: 'res-1', agency_id: 'agency-1' }],
    });
    await expect(
      superadminService.updateTrip(
        'trip-1',
        'route-1',
        FUTURE_DATE,
        'bus',
        ['agency-1', 'agency-2'],
      ),
    ).rejects.toThrow('reservas activas');
  });

  it('updateTrip still blocks removing an agency with active reservations', async () => {
    // Hard gate rejects any non-postpone edit with reservations.
    setupUpdateHappyPath({
      activeReservations: [{ id: 'res-1', agency_id: 'agency-2' }],
      currentAgencies: [{ agency_id: 'agency-1' }, { agency_id: 'agency-2' }],
    });
    await expect(
      superadminService.updateTrip(
        'trip-1',
        'route-1',
        FUTURE_DATE,
        'bus',
        ['agency-1'],
      ),
    ).rejects.toThrow('reservas activas');
  });

  it('validateAgencyRemoval still blocks remove when postpone skips hard gate', async () => {
    setupUpdateHappyPath({
      activeReservations: [{ id: 'res-1', agency_id: 'agency-2' }],
      currentAgencies: [{ agency_id: 'agency-1' }, { agency_id: 'agency-2' }],
    });
    await expect(
      superadminService.updateTrip(
        'trip-1',
        'route-1',
        FUTURE_DATE,
        'bus',
        ['agency-1'],
        true,
      ),
    ).rejects.toThrow('desasignar la agencia');
  });
});
