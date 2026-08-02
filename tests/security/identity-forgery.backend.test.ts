/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  FORGED_SUPERADMIN_METADATA,
  DB_AGENCY_USER,
} from './helpers/mock-supabase-auth.js';

function createChainable(result: unknown = null, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: result, error }));
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: result, error }));
  return chain;
}

const tableChains: Record<string, ReturnType<typeof createChainable>> = {};
const mockGetUser = vi.fn();

vi.mock('../../backend/src/config/database.js', () => ({
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

vi.mock('../../backend/src/services/email.service.js', () => ({
  emailService: {},
}));

import { auth } from '../../backend/src/middlewares/auth.js';
import { authorize } from '../../backend/src/middlewares/authorize.js';
import { authService } from '../../backend/src/services/auth.service.js';
import { ForbiddenError } from '../../backend/src/errors/index.js';

function mockReqRes(authHeader?: string) {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
  } as Request;
  const res = {} as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

function seedForgedJwtWithAgencyDbUser() {
  mockGetUser.mockResolvedValue({
    data: {
      user: {
        id: DB_AGENCY_USER.id,
        user_metadata: { ...FORGED_SUPERADMIN_METADATA },
      },
    },
    error: null,
  });

  tableChains.users = createChainable({
    id: DB_AGENCY_USER.id,
    role: DB_AGENCY_USER.role,
    agency_id: DB_AGENCY_USER.agency_id,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('SEC-007 — identity forgery (backend)', () => {
  describe('critical chain: JWT user_metadata vs public.users', () => {
    it('auth middleware keeps agency when metadata claims superadmin', async () => {
      seedForgedJwtWithAgencyDbUser();

      const { req, res, next } = mockReqRes('Bearer forged-token');

      await auth(req, res, next);

      expect(req.ctx).toEqual({
        userId: DB_AGENCY_USER.id,
        role: 'agency',
        agencyId: DB_AGENCY_USER.agency_id,
      });
      expect(next).toHaveBeenCalledOnce();
    });

    it('getMe (/auth/me) returns agency from public.users, ignoring forged metadata context', async () => {
      tableChains.users = createChainable({
        id: DB_AGENCY_USER.id,
        email: DB_AGENCY_USER.email,
        role: DB_AGENCY_USER.role,
        agency_id: DB_AGENCY_USER.agency_id,
      });
      tableChains.agencies = createChainable({ status: 'active' });

      const user = await authService.getMe(DB_AGENCY_USER.id);

      expect(user.role).toBe('agency');
      expect(user.agency_id).toBe(DB_AGENCY_USER.agency_id);
    });

    it('authorize(superadmin) rejects agency req.ctx — no privilege elevation', () => {
      const { req, res, next } = mockReqRes();
      req.ctx = {
        userId: DB_AGENCY_USER.id,
        role: 'agency',
        agencyId: DB_AGENCY_USER.agency_id,
      };

      expect(() => authorize('superadmin')(req, res, next)).toThrow(ForbiddenError);
      expect(next).not.toHaveBeenCalled();
    });

    it('full chain: auth then authorize blocks admin path with forged metadata', async () => {
      seedForgedJwtWithAgencyDbUser();

      const { req, res, next } = mockReqRes('Bearer forged-token');
      await auth(req, res, next);

      expect(req.ctx?.role).toBe('agency');

      const adminNext = vi.fn() as NextFunction;
      expect(() => authorize('superadmin')(req, res, adminNext)).toThrow(ForbiddenError);
      expect(adminNext).not.toHaveBeenCalled();
    });
  });
});
