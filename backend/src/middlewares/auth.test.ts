import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

function createChainable(result: unknown = null, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: result, error }));
  return chain;
}

const tableChains: Record<string, ReturnType<typeof createChainable>> = {};
const mockGetUser = vi.fn();

vi.mock('../config/database.js', () => ({
  get supabase() {
    return {
      auth: { getUser: mockGetUser },
    };
  },
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

import { auth } from './auth.js';
import { UnauthorizedError } from '../errors/index.js';

function mockReqRes(authHeader?: string) {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
  } as Request;
  const res = {} as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('auth middleware', () => {
  it('throws when authorization header is missing', async () => {
    const { req, res, next } = mockReqRes();

    await expect(auth(req, res, next)).rejects.toThrow(UnauthorizedError);
    expect(next).not.toHaveBeenCalled();
  });

  it('builds context from public.users, not user_metadata', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          user_metadata: { role: 'superadmin', agency_id: null },
        },
      },
      error: null,
    });

    tableChains['users'] = createChainable({
      id: 'user-1',
      role: 'agency',
      agency_id: 'agency-1',
    });

    const { req, res, next } = mockReqRes('Bearer valid-token');

    await auth(req, res, next);

    expect(req.ctx).toEqual({
      userId: 'user-1',
      role: 'agency',
      agencyId: 'agency-1',
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('throws when user is missing in public.users', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', user_metadata: { role: 'superadmin' } } },
      error: null,
    });

    tableChains['users'] = createChainable(null, { code: 'PGRST116' });

    const { req, res, next } = mockReqRes('Bearer valid-token');

    await expect(auth(req, res, next)).rejects.toThrow('Usuario no registrado');
    expect(next).not.toHaveBeenCalled();
  });

  it('throws when role in public.users is invalid', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    tableChains['users'] = createChainable({
      id: 'user-1',
      role: 'customer',
      agency_id: null,
    });

    const { req, res, next } = mockReqRes('Bearer valid-token');

    await expect(auth(req, res, next)).rejects.toThrow('Usuario no registrado');
  });
});
