import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgencyInactiveError, UnauthorizedError } from '../errors/index.js';

function createChainable(result: unknown = null, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: result, error }));
  return chain;
}

const tableChains: Record<string, ReturnType<typeof createChainable>> = {};

vi.mock('../config/database.js', () => ({
  supabase: {},
  get supabaseAdmin() {
    return {
      from: (table: string) => {
        if (!tableChains[table]) {
          tableChains[table] = createChainable();
        }
        return tableChains[table];
      },
    };
  },
}));

vi.mock('./email.service.js', () => ({
  emailService: {},
}));

import { authService } from './auth.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('authService.getMe', () => {
  it('returns identity from public.users only', async () => {
    tableChains.users = createChainable({
      id: 'user-1',
      email: 'agent@example.com',
      role: 'agency',
      agency_id: 'agency-1',
    });
    tableChains.agencies = createChainable({ status: 'active' });

    const user = await authService.getMe('user-1');

    expect(user).toEqual({
      id: 'user-1',
      email: 'agent@example.com',
      role: 'agency',
      agency_id: 'agency-1',
    });
  });

  it('throws when user is missing in public.users', async () => {
    tableChains.users = createChainable(null, { message: 'not found' });

    await expect(authService.getMe('missing')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws when agency subscription is inactive', async () => {
    tableChains.users = createChainable({
      id: 'user-1',
      email: 'agent@example.com',
      role: 'agency',
      agency_id: 'agency-1',
    });
    tableChains.agencies = createChainable({ status: 'inactive' });

    await expect(authService.getMe('user-1')).rejects.toBeInstanceOf(AgencyInactiveError);
  });

  it('allows superadmin without agency lookup', async () => {
    tableChains.users = createChainable({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'superadmin',
      agency_id: null,
    });

    const user = await authService.getMe('admin-1');

    expect(user.role).toBe('superadmin');
    expect(tableChains.agencies).toBeUndefined();
  });
});
