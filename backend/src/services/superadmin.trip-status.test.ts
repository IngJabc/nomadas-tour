import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Matriz efectiva de permisos sobre las transiciones de estado de un
 * viaje (completar / cancelar / archivar).
 *
 * Capas cubiertas aqui (capa de servicio = lo que el HTTP llega a
 * ejecutar):
 *   - superadmin: completa y cancela cualquier viaje elegible
 *   - agency:     solo COMPLETA viajes exclusivamente suyos
 *   - agency:     nunca cancela un viaje entero ni archiva
 *   - customer / anónimo / sin actor: denegado
 *   - el actor viene de la sesión (req.ctx), nunca del body
 *   - no existe ningún UPDATE directo sobre trips.status
 *
 * La segunda capa (RPC SECURITY DEFINER, migración 104) re-valida lo
 * mismo dentro de la transacción y no se puede evadir llamando al RPC
 * con service_role.
 */

const mockEnv = vi.hoisted(() => ({
  TRIP_EFFECTS_VIA_OUTBOX: true,
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
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.single = vi.fn(() =>
    Promise.resolve({ data: defaultResult, error: defaultError }),
  );
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: defaultResult, error: defaultError }),
  );
  chain.then = vi.fn((resolve: any, reject: any) => {
    const arr = Array.isArray(defaultResult) ? defaultResult : [];
    Promise.resolve({ data: defaultResult, error: defaultError, count: arr.length }).then(
      resolve,
      reject,
    );
  });
  chain.update = vi.fn(() => createChainable());
  chain.insert = vi.fn(() => Promise.resolve({ data: null, error: null }));
  chain.delete = vi.fn(() => createChainable());
  return chain;
}

const tableChains: Record<string, any> = {};

const mockFrom = vi.fn((table: string) => {
  if (!tableChains[table]) tableChains[table] = createChainable();
  return tableChains[table];
});

vi.mock('../config/database.js', () => ({
  get supabaseAdmin() {
    return { from: mockFrom, rpc: mockRpc };
  },
}));

const mockCreateForAgenciesAndAdmin = vi.fn(() => Promise.resolve(undefined));

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
    createForAgenciesAndAdmin: (...args: unknown[]) =>
      mockCreateForAgenciesAndAdmin(...args),
  },
}));

vi.mock('./notification-preference.service.js', () => ({
  notificationPreferenceService: { seedDefaults: vi.fn() },
}));

vi.mock('./notification-delivery.policy.js', () => ({
  notificationDeliveryPolicy: {
    shouldDeliver: vi.fn(() => Promise.resolve(false)),
  },
}));

vi.mock('./agency-settings.service.js', () => ({
  agencySettingsService: { seedBrandingDefaults: vi.fn() },
}));

vi.mock('../utils/subdomain.js', () => ({
  generateUniqueSubdomain: vi.fn(),
}));

vi.mock('../utils/token.js', () => ({
  generateToken: vi.fn(),
}));

import { superadminService } from './superadmin.service.js';
import { emailService } from './email.service.js';
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../errors/index.js';
import type { RequestContext } from '../types/index.js';

const FUTURE_DATE = new Date(Date.now() + 86_400_000).toISOString();
const PAST_DATE = new Date(Date.now() - 86_400_000).toISOString();

const SUPERADMIN: RequestContext = {
  userId: 'user-super',
  role: 'superadmin',
  agencyId: null,
};
const AGENCY_A: RequestContext = {
  userId: 'user-a',
  role: 'agency',
  agencyId: 'agency-1',
};

function tripRow(overrides: Record<string, any> = {}) {
  return {
    id: 'trip-1',
    status: 'active',
    departure_time: PAST_DATE,
    route_id: 'route-1',
    ...overrides,
  };
}

/** Trip + relaciones. `agencies` = agencias asignadas al viaje. */
function setupTrip(opts: {
  trip?: Record<string, any>;
  agencies?: string[];
  reservations?: { id: string; status: string }[];
} = {}) {
  const {
    trip = tripRow(),
    agencies = ['agency-1'],
    reservations = [],
  } = opts;

  tableChains['trips'] = createChainable(trip);
  tableChains['trip_agencies'] = createChainable(
    agencies.map((agency_id) => ({ agency_id })),
  );
  tableChains['reservations'] = createChainable(reservations);
  tableChains['routes'] = createChainable({
    origin: 'Caracas',
    destination: 'Maracaibo',
  });
  tableChains['agencies'] = createChainable([]);
}

function resetTableChains() {
  for (const key of Object.keys(tableChains)) delete tableChains[key];
}

beforeEach(() => {
  resetTableChains();
  mockRpc.mockReset();
  mockFrom.mockClear();
  mockCreateForAgenciesAndAdmin.mockClear();
  mockEnv.TRIP_EFFECTS_VIA_OUTBOX = true;
});

afterEach(() => {
  mockEnv.TRIP_EFFECTS_VIA_OUTBOX = true;
});

describe('trip status — superadmin', () => {
  it('completes an eligible exclusive trip', async () => {
    setupTrip({ agencies: ['agency-1'] });
    mockRpc.mockResolvedValue({
      data: { trip_id: 'trip-1', status: 'completed' },
      error: null,
    });

    const result = await superadminService.updateTripStatus(
      'trip-1',
      'completed',
      SUPERADMIN,
    );

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('set_trip_status', {
      p_trip_id: 'trip-1',
      p_status: 'completed',
      p_actor_user_id: 'user-super',
    });
    expect(result).toEqual({ id: 'trip-1', status: 'completed' });
  });

  it('completes an eligible shared trip (varias agencias)', async () => {
    setupTrip({ agencies: ['agency-1', 'agency-2'] });
    mockRpc.mockResolvedValue({
      data: { trip_id: 'trip-1', status: 'completed' },
      error: null,
    });

    const result = await superadminService.updateTripStatus(
      'trip-1',
      'completed',
      SUPERADMIN,
    );

    expect(result.status).toBe('completed');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('cancels a trip without reservations', async () => {
    setupTrip({ trip: tripRow({ departure_time: FUTURE_DATE }), reservations: [] });
    mockRpc.mockResolvedValue({
      data: { trip_id: 'trip-1', status: 'cancelled' },
      error: null,
    });

    const result = await superadminService.updateTripStatus(
      'trip-1',
      'cancelled',
      SUPERADMIN,
    );

    expect(result.status).toBe('cancelled');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('cannot cancel a trip that still has reservations', async () => {
    setupTrip({
      trip: tripRow({ departure_time: FUTURE_DATE }),
      reservations: [{ id: 'res-1', status: 'confirmed' }],
    });

    await expect(
      superadminService.updateTripStatus('trip-1', 'cancelled', SUPERADMIN),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(tableChains['trips'].update).not.toHaveBeenCalled();
  });

  it('keeps the departure-time windows (no completa antes / no cancela después)', async () => {
    setupTrip({ trip: tripRow({ departure_time: FUTURE_DATE }) });
    await expect(
      superadminService.updateTripStatus('trip-1', 'completed', SUPERADMIN),
    ).rejects.toBeInstanceOf(ForbiddenError);

    setupTrip({ trip: tripRow({ departure_time: PAST_DATE }) });
    await expect(
      superadminService.updateTripStatus('trip-1', 'cancelled', SUPERADMIN),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('trip status — agency', () => {
  it('completes its own exclusive trip', async () => {
    setupTrip({ agencies: ['agency-1'] });
    mockRpc.mockResolvedValue({
      data: { trip_id: 'trip-1', status: 'completed' },
      error: null,
    });

    const result = await superadminService.updateTripStatus(
      'trip-1',
      'completed',
      AGENCY_A,
    );

    expect(result.status).toBe('completed');
    expect(mockRpc).toHaveBeenCalledWith('set_trip_status', {
      p_trip_id: 'trip-1',
      p_status: 'completed',
      p_actor_user_id: 'user-a',
    });
  });

  it('cannot complete a trip assigned to another agency', async () => {
    setupTrip({ agencies: ['agency-2'] });

    await expect(
      superadminService.updateTripStatus('trip-1', 'completed', AGENCY_A),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('cannot complete a shared trip', async () => {
    setupTrip({ agencies: ['agency-1', 'agency-2'] });

    await expect(
      superadminService.updateTripStatus('trip-1', 'completed', AGENCY_A),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('cannot cancel a whole trip', async () => {
    setupTrip({
      trip: tripRow({ departure_time: FUTURE_DATE }),
      agencies: ['agency-1'],
      reservations: [],
    });

    await expect(
      superadminService.updateTripStatus('trip-1', 'cancelled', AGENCY_A),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(tableChains['trips'].update).not.toHaveBeenCalled();
  });

  it('cannot archive a trip', async () => {
    setupTrip({ trip: tripRow({ status: 'cancelled' }) });

    await expect(
      superadminService.archiveTrip('trip-1', AGENCY_A),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(tableChains['trips'].update).not.toHaveBeenCalled();
    expect(tableChains['trips'].delete).not.toHaveBeenCalled();
  });
});

describe('trip status — customer / unauthenticated', () => {
  it('rejects a customer role', async () => {
    setupTrip();

    await expect(
      superadminService.updateTripStatus('trip-1', 'completed', {
        userId: 'user-customer',
        role: 'customer' as any,
        agencyId: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a missing actor (sin sesión no hay transición)', async () => {
    setupTrip();

    await expect(
      superadminService.updateTripStatus('trip-1', 'completed', {
        userId: '',
        role: 'agency',
        agencyId: 'agency-1',
      } as RequestContext),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      superadminService.updateTripStatus('trip-1', 'completed', undefined as any),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(tableChains['trips'].update).not.toHaveBeenCalled();
  });
});

describe('trip status — sin atajos de base de datos', () => {
  it('never updates trips.status directly: only the RPC does', async () => {
    setupTrip({ agencies: ['agency-1'] });
    mockRpc.mockResolvedValue({
      data: { trip_id: 'trip-1', status: 'completed' },
      error: null,
    });

    await superadminService.updateTripStatus('trip-1', 'completed', SUPERADMIN);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(tableChains['trips'].update).not.toHaveBeenCalled();
  });

  it('emits the outbox event exactly once (flag on → worker is the only emitter)', async () => {
    setupTrip({
      trip: tripRow({ departure_time: FUTURE_DATE }),
      agencies: ['agency-1'],
      reservations: [],
    });
    mockRpc.mockResolvedValue({
      data: { trip_id: 'trip-1', status: 'cancelled' },
      error: null,
    });

    await superadminService.updateTripStatus('trip-1', 'cancelled', SUPERADMIN);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockCreateForAgenciesAndAdmin).not.toHaveBeenCalled();
    expect(emailService.sendTripCancelledEmail).not.toHaveBeenCalled();
  });

  it('emits side effects exactly once when the outbox flag is off', async () => {
    mockEnv.TRIP_EFFECTS_VIA_OUTBOX = false;
    setupTrip({
      trip: tripRow({ departure_time: FUTURE_DATE }),
      agencies: ['agency-1'],
      reservations: [],
    });
    mockRpc.mockResolvedValue({
      data: { trip_id: 'trip-1', status: 'cancelled' },
      error: null,
    });

    await superadminService.updateTripStatus('trip-1', 'cancelled', SUPERADMIN);

    // Un solo estado de transición: el RPC. Sin update directo.
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(tableChains['trips'].update).not.toHaveBeenCalled();
    // Efectos legacy emitidos una sola vez.
    expect(mockCreateForAgenciesAndAdmin).toHaveBeenCalledTimes(1);
  });
});

describe('trip status — mapeo de errores del RPC (migración 104)', () => {
  it('maps ERR_TRIP_HAS_RESERVATIONS to ConflictError', async () => {
    setupTrip({ trip: tripRow({ departure_time: FUTURE_DATE }), reservations: [] });
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'ERR_TRIP_HAS_RESERVATIONS: No se puede cancelar' },
    });

    await expect(
      superadminService.updateTripStatus('trip-1', 'cancelled', SUPERADMIN),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('maps ERR_TRIP_NOT_EXCLUSIVE to ForbiddenError', async () => {
    setupTrip({ agencies: ['agency-1'] });
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'ERR_TRIP_NOT_EXCLUSIVE: no exclusivo' },
    });

    await expect(
      superadminService.updateTripStatus('trip-1', 'completed', SUPERADMIN),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('maps ERR_ACTOR_REQUIRED to ForbiddenError', async () => {
    setupTrip();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'ERR_ACTOR_REQUIRED: actor autenticado requerido' },
    });

    await expect(
      superadminService.updateTripStatus('trip-1', 'completed', SUPERADMIN),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('maps unexpected RPC errors to ValidationError', async () => {
    setupTrip();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });

    await expect(
      superadminService.updateTripStatus('trip-1', 'completed', SUPERADMIN),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('archivar — superadmin-only y preserva el historial', () => {
  it('archives a cancelled trip without deleting anything', async () => {
    const trips = createChainable(tripRow({ status: 'cancelled' }));
    tableChains['trips'] = trips;
    tableChains['trip_agencies'] = createChainable([{ agency_id: 'agency-1' }]);
    tableChains['routes'] = createChainable({
      origin: 'Caracas',
      destination: 'Maracaibo',
    });
    tableChains['reservations'] = createChainable([
      { id: 'res-1', status: 'completed' },
    ]);
    mockRpc.mockResolvedValue({
      data: { trip_id: 'trip-1', status: 'archived' },
      error: null,
    });

    const result = await superadminService.archiveTrip('trip-1', SUPERADMIN);

    expect(result).toEqual({ id: 'trip-1', status: 'archived' });
    // El viaje y su historial siguen ahí: nada se borra.
    expect(trips.delete).not.toHaveBeenCalled();
    expect(tableChains['reservations'].delete).not.toHaveBeenCalled();
    expect(tableChains['trip_agencies'].delete).not.toHaveBeenCalled();
  });

  it('never exposes an unarchive operation', () => {
    expect(
      (superadminService as unknown as Record<string, unknown>).unarchiveTrip,
    ).toBeUndefined();
  });
});
