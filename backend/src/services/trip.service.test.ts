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

const mockFrom = vi.fn((table: string) => buildTableChain(table));

vi.mock('../config/database.js', () => ({
  get supabaseAdmin() {
    return { from: mockFrom };
  },
}));

// Now import after mock
import { completeExpiredTrips } from './trip.service.js';

beforeEach(() => {
  vi.clearAllMocks();
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
});
