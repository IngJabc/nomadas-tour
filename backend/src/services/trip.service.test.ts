import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock database BEFORE any imports ────────────────────────────────
function createChainable(result: any = [], error: any = null) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.ilike = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.lt = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: result, error }));
  chain.update = vi.fn((_data?: any) => {
    const updateChain = createChainable();
    updateChain.eq = vi.fn(() => updateChain);
    updateChain.lt = vi.fn(() => updateChain);
    updateChain.select = vi.fn(() => updateChain);
    updateChain.then = vi.fn((resolve: any) =>
      resolve({ data: result, error, count: Array.isArray(result) ? result.length : 0 })
    );
    return updateChain;
  });
  chain.then = vi.fn((resolve: any) => {
    const arr = Array.isArray(result) ? result : result ? [result] : [];
    resolve({ data: result, error, count: arr.length });
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

const mockEnv = vi.hoisted(() => ({
  TRIP_EFFECTS_VIA_OUTBOX: false,
}));

const mockRpc = vi.hoisted(() => vi.fn());

const mockFrom = vi.fn((table: string) => buildTableChain(table));

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
    LOCK_TTL_SECONDS: 300,
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

vi.mock('../config/database.js', () => ({
  get supabaseAdmin() {
    return { from: mockFrom, rpc: mockRpc };
  },
}));

vi.mock('./notification.service.js', () => ({
  notificationService: {
    createForAgenciesAndAdmin: vi.fn(() => Promise.resolve(undefined)),
  },
}));

// Now import after mock
import { completeExpiredTrips } from './trip.service.js';
import { notificationService } from './notification.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.TRIP_EFFECTS_VIA_OUTBOX = false;
  mockRpc.mockReset();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('completeExpiredTrips', () => {
  it('completes only active trips that departed more than 3 days ago', async () => {
    const completedTrips = [
      { id: 'trip-1', status: 'completed' },
      { id: 'trip-2', status: 'completed' },
    ];
    tableChains['trips'] = createChainable();

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await completeExpiredTrips();

    expect(mockFrom).toHaveBeenCalledWith('trips');
    const chain = tableChains['trips'];
    expect(chain.update).toHaveBeenCalledWith({ status: 'completed' });

    consoleSpy.mockRestore();
  });

  it('does not complete cancelled trips', async () => {
    tableChains['trips'] = createChainable();

    await completeExpiredTrips();

    // The key assertion: .eq('status', 'active') must be used instead of .neq('status', 'completed')
    const chain = tableChains['trips'];
    expect(chain.update).toHaveBeenCalled();
    // The update chain is what gets .eq('status', 'active')
    const updateChain = chain.update.mock.results[0].value;
    expect(updateChain.eq).toHaveBeenCalledWith('status', 'active');
  });

  it('logs error when database query fails', async () => {
    const errorChain = createChainable();
    errorChain.update = vi.fn((_data?: any) => {
      const updateChain = createChainable([], { message: 'db error' });
      updateChain.eq = vi.fn(() => updateChain);
      updateChain.lt = vi.fn(() => updateChain);
      updateChain.select = vi.fn(() => updateChain);
      updateChain.then = vi.fn((resolve: any) =>
        resolve({ data: null, error: { message: 'db error' }, count: 0 })
      );
      return updateChain;
    });
    tableChains['trips'] = errorChain;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await completeExpiredTrips();

    expect(consoleSpy).toHaveBeenCalledWith('[TripCleanup] Error:', 'db error');
    consoleSpy.mockRestore();
  });

  it('does not log when no trips are completed', async () => {
    tableChains['trips'] = createChainable([]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await completeExpiredTrips();

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('legacy path updates trips and notifies without calling complete_trip', async () => {
    const completedTrips = [
      {
        id: 'trip-1',
        status: 'completed',
        route_id: 'route-1',
      },
    ];
    tableChains['trips'] = createChainable(completedTrips);
    tableChains['trip_agencies'] = createChainable([{ agency_id: 'agency-1' }]);
    tableChains['routes'] = createChainable({
      origin: 'Caracas',
      destination: 'Mérida',
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await completeExpiredTrips();

    expect(tableChains['trips'].update).toHaveBeenCalledWith({
      status: 'completed',
    });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(notificationService.createForAgenciesAndAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trip_auto_completed',
        entityId: 'trip-1',
        agencyIds: ['agency-1'],
        actor: 'system',
      }),
    );

    consoleSpy.mockRestore();
  });
});

describe('WKR-007 C3 — completeExpiredTrips via complete_trip', () => {
  beforeEach(() => {
    mockEnv.TRIP_EFFECTS_VIA_OUTBOX = true;
  });

  it('calls complete_trip per expired trip without legacy update or notification', async () => {
    tableChains['trips'] = createChainable([{ id: 'trip-a' }, { id: 'trip-b' }]);
    mockRpc.mockResolvedValue({
      data: { trip_id: 'trip-a', status: 'completed', source: 'auto' },
      error: null,
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await completeExpiredTrips();

    expect(tableChains['trips'].select).toHaveBeenCalledWith('id');
    expect(tableChains['trips'].eq).toHaveBeenCalledWith('status', 'active');
    expect(tableChains['trips'].lt).toHaveBeenCalledWith(
      'departure_time',
      expect.any(String),
    );
    expect(tableChains['trips'].update).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'complete_trip', {
      p_trip_id: 'trip-a',
      p_source: 'auto',
    });
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'complete_trip', {
      p_trip_id: 'trip-b',
      p_source: 'auto',
    });
    expect(notificationService.createForAgenciesAndAdmin).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[TripCleanup] Completed 2 expired trip(s)',
    );

    consoleSpy.mockRestore();
  });

  it('calls complete_trip once for each of three expired trips', async () => {
    tableChains['trips'] = createChainable([
      { id: 'trip-a' },
      { id: 'trip-b' },
      { id: 'trip-c' },
    ]);
    mockRpc.mockResolvedValue({ data: { status: 'completed' }, error: null });

    await completeExpiredTrips();

    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(mockRpc).toHaveBeenCalledWith('complete_trip', {
      p_trip_id: 'trip-a',
      p_source: 'auto',
    });
    expect(mockRpc).toHaveBeenCalledWith('complete_trip', {
      p_trip_id: 'trip-b',
      p_source: 'auto',
    });
    expect(mockRpc).toHaveBeenCalledWith('complete_trip', {
      p_trip_id: 'trip-c',
      p_source: 'auto',
    });
    expect(tableChains['trips'].update).not.toHaveBeenCalled();
    expect(notificationService.createForAgenciesAndAdmin).not.toHaveBeenCalled();
  });

  it('logs RPC errors and continues processing remaining trips', async () => {
    tableChains['trips'] = createChainable([
      { id: 'trip-fail' },
      { id: 'trip-ok' },
    ]);
    mockRpc
      .mockResolvedValueOnce({
        data: null,
        error: {
          message: 'ERR_INVALID_SOURCE: source must be manual or auto',
        },
      })
      .mockResolvedValueOnce({
        data: { trip_id: 'trip-ok', status: 'completed', source: 'auto' },
        error: null,
      });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await completeExpiredTrips();

    expect(errorSpy).toHaveBeenCalledWith(
      '[TripCleanup] Error:',
      'ERR_INVALID_SOURCE: source must be manual or auto',
    );
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(
      '[TripCleanup] Completed 1 expired trip(s)',
    );
    expect(notificationService.createForAgenciesAndAdmin).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('logs detection query errors without calling complete_trip', async () => {
    tableChains['trips'] = createChainable([], { message: 'select failed' });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await completeExpiredTrips();

    expect(errorSpy).toHaveBeenCalledWith(
      '[TripCleanup] Error:',
      'select failed',
    );
    expect(mockRpc).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
