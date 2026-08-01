import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

function createChainable(result: unknown = null, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: result, error }));
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: result, error }));
  return chain;
}

const tableChains: Record<string, ReturnType<typeof createChainable>> = {};

vi.mock('../config/database.js', () => ({
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

import { tenant } from './tenant.js';
import { ForbiddenError, NotFoundError, AgencyInactiveError } from '../errors/index.js';

function mockReqRes(ctx?: { userId: string; agencyId: string | null }, path = '/agency/trips') {
  const req = {
    ctx: ctx
      ? { userId: ctx.userId, role: 'agency' as const, agencyId: ctx.agencyId }
      : undefined,
    path,
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

describe('tenant middleware', () => {
  it('throws NotFoundError when ctx is incomplete', async () => {
    const { req, res, next } = mockReqRes({ userId: 'u1', agencyId: null });

    await expect(tenant(req, res, next)).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when user agency_id does not match ctx', async () => {
    tableChains['users'] = createChainable({
      id: 'user-1',
      role: 'agency',
      agency_id: 'agency-other',
    });

    const { req, res, next } = mockReqRes({ userId: 'user-1', agencyId: 'agency-1' });

    await expect(tenant(req, res, next)).rejects.toThrow(ForbiddenError);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws ForbiddenError when user role is not agency', async () => {
    tableChains['users'] = createChainable({
      id: 'user-1',
      role: 'superadmin',
      agency_id: 'agency-1',
    });

    const { req, res, next } = mockReqRes({ userId: 'user-1', agencyId: 'agency-1' });

    await expect(tenant(req, res, next)).rejects.toThrow(ForbiddenError);
  });

  it('continues when user belongs to agency and agency is active', async () => {
    tableChains['users'] = createChainable({
      id: 'user-1',
      role: 'agency',
      agency_id: 'agency-1',
    });
    tableChains['agencies'] = createChainable({ id: 'agency-1', status: 'active' });

    const { req, res, next } = mockReqRes({ userId: 'user-1', agencyId: 'agency-1' });

    await tenant(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('throws AgencyInactiveError for inactive agency on normal paths', async () => {
    tableChains['users'] = createChainable({
      id: 'user-1',
      role: 'agency',
      agency_id: 'agency-1',
    });
    tableChains['agencies'] = createChainable({ id: 'agency-1', status: 'inactive' });

    const { req, res, next } = mockReqRes({ userId: 'user-1', agencyId: 'agency-1' });

    await expect(tenant(req, res, next)).rejects.toThrow(AgencyInactiveError);
  });

  it('allows unlock paths even when agency is inactive', async () => {
    tableChains['users'] = createChainable({
      id: 'user-1',
      role: 'agency',
      agency_id: 'agency-1',
    });
    tableChains['agencies'] = createChainable({ id: 'agency-1', status: 'inactive' });

    const { req, res, next } = mockReqRes(
      { userId: 'user-1', agencyId: 'agency-1' },
      '/agency/seats/unlock-all-user',
    );

    await tenant(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
