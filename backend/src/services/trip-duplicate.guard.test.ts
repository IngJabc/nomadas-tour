import { describe, it, expect, vi, beforeEach } from 'vitest';

function createChainable(result: any = null, error: any = null) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: result, error }));
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

import {
  assertNoDuplicateTrip,
  DUPLICATE_TRIP_MESSAGE,
} from './trip-duplicate.guard.js';
import { ConflictError } from '../errors/index.js';

const FUTURE_DATE = new Date(Date.now() + 86_400_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('assertNoDuplicateTrip', () => {
  it('throws ConflictError when a trip already exists for the route and departure time', async () => {
    tableChains['trips'] = createChainable({ id: 'existing-trip' });

    await expect(
      assertNoDuplicateTrip('route-1', FUTURE_DATE),
    ).rejects.toThrow(ConflictError);

    await expect(
      assertNoDuplicateTrip('route-1', FUTURE_DATE),
    ).rejects.toThrow(DUPLICATE_TRIP_MESSAGE);
  });

  it('allows the same departure time for a different route', async () => {
    tableChains['trips'] = createChainable(null);

    await expect(
      assertNoDuplicateTrip('route-2', FUTURE_DATE),
    ).resolves.toBeUndefined();
  });

  it('throws ConflictError when updating to a slot occupied by another trip', async () => {
    tableChains['trips'] = createChainable({ id: 'other-trip' });

    await expect(
      assertNoDuplicateTrip('route-1', FUTURE_DATE, 'trip-1'),
    ).rejects.toThrow(DUPLICATE_TRIP_MESSAGE);
  });

  it('allows update when only the same trip occupies the slot', async () => {
    tableChains['trips'] = createChainable(null);

    await expect(
      assertNoDuplicateTrip('route-1', FUTURE_DATE, 'trip-1'),
    ).resolves.toBeUndefined();
  });
});
