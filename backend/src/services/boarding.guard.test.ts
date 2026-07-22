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
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: result, error }));
  chain.single = vi.fn(() => Promise.resolve({ data: result, error }));
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

const mockFrom = vi.fn((table: string) => buildTableChain(table));

vi.mock('../config/database.js', () => ({
  get supabaseAdmin() {
    return { from: mockFrom };
  },
}));

// Now import after mock
import { validateBoardingAllowed } from './boarding.guard.js';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('validateBoardingAllowed', () => {
  const ctx = { tripId: 'trip-1', agencyId: 'agency-1' };

  function pastDeparture(): string {
    return new Date(Date.now() - 86_400_000).toISOString();
  }

  function futureDeparture(): string {
    return new Date(Date.now() + 86_400_000).toISOString();
  }

  it('allows boarding when trip is active, departed, and agency is assigned', async () => {
    tableChains['trips'] = createChainable({ status: 'active', departure_time: pastDeparture() });
    tableChains['trip_agencies'] = createChainable({ id: 'assigned' });

    await expect(validateBoardingAllowed(ctx)).resolves.toBeUndefined();
  });

  it('allows boarding when departure_time is exactly now', async () => {
    const now = new Date().toISOString();
    tableChains['trips'] = createChainable({ status: 'active', departure_time: now });
    tableChains['trip_agencies'] = createChainable({ id: 'assigned' });

    await expect(validateBoardingAllowed(ctx)).resolves.toBeUndefined();
  });

  it('allows boarding when trip departed in the past', async () => {
    tableChains['trips'] = createChainable({ status: 'active', departure_time: pastDeparture() });
    tableChains['trip_agencies'] = createChainable({ id: 'assigned' });

    await expect(validateBoardingAllowed(ctx)).resolves.toBeUndefined();
  });

  it('rejects when trip is in the future (departure_time > now)', async () => {
    tableChains['trips'] = createChainable({ status: 'active', departure_time: futureDeparture() });

    await expect(validateBoardingAllowed(ctx)).rejects.toThrow('aún no ha salido');
  });

  it('rejects when trip is cancelled', async () => {
    tableChains['trips'] = createChainable({ status: 'cancelled', departure_time: pastDeparture() });

    await expect(validateBoardingAllowed(ctx)).rejects.toThrow('cancelado');
  });

  it('rejects when trip is completed', async () => {
    tableChains['trips'] = createChainable({ status: 'completed', departure_time: pastDeparture() });

    await expect(validateBoardingAllowed(ctx)).rejects.toThrow('completado');
  });

  it('rejects when trip is not found', async () => {
    tableChains['trips'] = createChainable(null, { message: 'not found' });

    await expect(validateBoardingAllowed(ctx)).rejects.toThrow('no encontrado');
  });

  it('rejects when agency is not assigned to the trip', async () => {
    tableChains['trips'] = createChainable({ status: 'active', departure_time: pastDeparture() });
    tableChains['trip_agencies'] = createChainable(null);

    tableChains['trip_agencies'].maybeSingle = vi.fn(() =>
      Promise.resolve({ data: null, error: null })
    );

    await expect(validateBoardingAllowed(ctx)).rejects.toThrow('no está asignada');
  });
});
