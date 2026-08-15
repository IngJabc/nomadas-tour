import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ValidationError } from '../errors/index.js';
import { encodeAuditCursor } from '../utils/audit-cursor.js';

const mockGetAdminAudit = vi.fn();
const mockGetAgencyAudit = vi.fn();

vi.mock('../services/audit.service.js', () => ({
  auditService: {
    getAdminAudit: (...args: unknown[]) => mockGetAdminAudit(...args),
    getAgencyAudit: (...args: unknown[]) => mockGetAgencyAudit(...args),
  },
}));

import {
  auditController,
  MAX_AUDIT_RANGE_MS,
  resolveAuditTimeFilters,
} from './audit.controller.js';

const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AGENCY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_1 = '44444444-4444-4444-8444-444444444444';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const T1 = '2026-08-15T12:00:00.000Z';
const T2 = '2026-08-14T12:00:00.000Z';

function createReqRes(opts: {
  role: 'superadmin' | 'agency';
  agencyId?: string | null;
  query?: Record<string, unknown>;
}) {
  const req = {
    ctx: {
      userId: ACTOR,
      role: opts.role,
      agencyId: opts.agencyId ?? null,
    },
    query: opts.query ?? {},
  } as unknown as Request;
  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAdminAudit.mockResolvedValue({ items: [], next_cursor: null });
  mockGetAgencyAudit.mockResolvedValue({ items: [], next_cursor: null });
});

describe('AuditController.getAdminAudit', () => {
  it('returns 200 with validated query (default limit 50)', async () => {
    const { req, res, next, json } = createReqRes({ role: 'superadmin' });

    await auditController.getAdminAudit(req, res, next);

    expect(mockGetAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
    expect(json).toHaveBeenCalledWith({ items: [], next_cursor: null });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes admin filters including agency_id', async () => {
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: {
        agency_id: AGENCY_A,
        action: 'trip.created',
        entity_type: 'trip',
        entity_id: EVENT_1,
        actor_user_id: ACTOR,
        from: T2,
        to: T1,
        limit: '25',
      },
    });

    await auditController.getAdminAudit(req, res, next);

    expect(mockGetAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        agency_id: AGENCY_A,
        action: 'trip.created',
        entity_type: 'trip',
        entity_id: EVENT_1,
        actor_user_id: ACTOR,
        from: T2,
        to: T1,
        limit: 25,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID', async () => {
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: { entity_id: 'not-a-uuid' },
    });

    await auditController.getAdminAudit(req, res, next);

    expect(mockGetAdminAudit).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('rejects invalid datetime', async () => {
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: { from: 'yesterday' },
    });

    await auditController.getAdminAudit(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('rejects to < from', async () => {
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: { from: T1, to: T2 },
    });

    await auditController.getAdminAudit(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('rejects range > 90 days', async () => {
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-05-01T00:00:00.000Z',
      },
    });

    await auditController.getAdminAudit(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('accepts from+to within 90 days', async () => {
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: { from: T2, to: T1 },
    });

    await auditController.getAdminAudit(req, res, next);
    expect(mockGetAdminAudit).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts from-only within 90 days of now', async () => {
    const from = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: { from },
    });

    await auditController.getAdminAudit(req, res, next);
    expect(mockGetAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ from, to: undefined }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects from-only older than 90 days', async () => {
    const from = new Date(Date.now() - (MAX_AUDIT_RANGE_MS + 86_400_000)).toISOString();
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: { from },
    });

    await auditController.getAdminAudit(req, res, next);
    expect(mockGetAdminAudit).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('accepts to-only within 90 days and clamps from=to-90d', async () => {
    const to = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const expectedFrom = new Date(Date.parse(to) - MAX_AUDIT_RANGE_MS).toISOString();
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: { to },
    });

    await auditController.getAdminAudit(req, res, next);
    expect(mockGetAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ from: expectedFrom, to }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects to-only older than 90 days', async () => {
    const to = new Date(Date.now() - (MAX_AUDIT_RANGE_MS + 86_400_000)).toISOString();
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: { to },
    });

    await auditController.getAdminAudit(req, res, next);
    expect(mockGetAdminAudit).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('accepts query without dates (recent feed)', async () => {
    const { req, res, next } = createReqRes({ role: 'superadmin', query: {} });
    await auditController.getAdminAudit(req, res, next);
    expect(mockGetAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ from: undefined, to: undefined, limit: 50 }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('resolveAuditTimeFilters clamps Case C only', () => {
    expect(resolveAuditTimeFilters(undefined, T1)).toEqual({
      from: new Date(Date.parse(T1) - MAX_AUDIT_RANGE_MS).toISOString(),
      to: T1,
    });
    expect(resolveAuditTimeFilters(T2, T1)).toEqual({ from: T2, to: T1 });
    expect(resolveAuditTimeFilters(T2, undefined)).toEqual({
      from: T2,
      to: undefined,
    });
    expect(resolveAuditTimeFilters(undefined, undefined)).toEqual({
      from: undefined,
      to: undefined,
    });
  });

  it('rejects limit < 1 and > 100', async () => {
    const low = createReqRes({ role: 'superadmin', query: { limit: '0' } });
    await auditController.getAdminAudit(low.req, low.res, low.next);
    expect(low.next).toHaveBeenCalledWith(expect.any(ValidationError));

    const high = createReqRes({ role: 'superadmin', query: { limit: '101' } });
    await auditController.getAdminAudit(high.req, high.res, high.next);
    expect(high.next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('rejects invalid cursor', async () => {
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: { cursor: '%%%' },
    });

    await auditController.getAdminAudit(req, res, next);
    expect(mockGetAdminAudit).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('rejects entity_id without entity_type', async () => {
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: { entity_id: EVENT_1 },
    });

    await auditController.getAdminAudit(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('rejects offset/sort/count (strict)', async () => {
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: { offset: '0' },
    });

    await auditController.getAdminAudit(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('decodes valid cursor into service filters', async () => {
    const cursor = encodeAuditCursor({ t: T1, i: EVENT_1 });
    const { req, res, next } = createReqRes({
      role: 'superadmin',
      query: { cursor },
    });

    await auditController.getAdminAudit(req, res, next);

    expect(mockGetAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { t: T1, i: EVENT_1 },
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates service errors', async () => {
    mockGetAdminAudit.mockRejectedValueOnce(new Error('boom'));
    const { req, res, next } = createReqRes({ role: 'superadmin' });

    await auditController.getAdminAudit(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('AuditController.getAgencyAudit', () => {
  it('returns 200 using ctx.agencyId (not query)', async () => {
    const { req, res, next, json } = createReqRes({
      role: 'agency',
      agencyId: AGENCY_A,
      query: { action: 'boarding.board' },
    });

    await auditController.getAgencyAudit(req, res, next);

    expect(mockGetAgencyAudit).toHaveBeenCalledWith(
      AGENCY_A,
      expect.objectContaining({
        action: 'boarding.board',
        limit: 50,
      }),
    );
    expect(json).toHaveBeenCalledWith({ items: [], next_cursor: null });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects agency_id query param with 400', async () => {
    const { req, res, next } = createReqRes({
      role: 'agency',
      agencyId: AGENCY_A,
      query: { agency_id: AGENCY_B },
    });

    await auditController.getAgencyAudit(req, res, next);

    expect(mockGetAgencyAudit).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as ValidationError;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
  });

  it('requires agency context', async () => {
    const { req, res, next } = createReqRes({
      role: 'agency',
      agencyId: null,
    });

    await auditController.getAgencyAudit(req, res, next);
    expect(mockGetAgencyAudit).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});
