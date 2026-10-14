import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ValidationError } from '../errors/index.js';

const mockList = vi.fn();
const mockGetDetail = vi.fn();
const mockGetProof = vi.fn();
const mockVerify = vi.fn();
const mockReject = vi.fn();

vi.mock('../services/payment.service.js', () => ({
  paymentService: {
    listAgencyPayments: (...args: unknown[]) => mockList(...args),
    getAgencyPaymentDetail: (...args: unknown[]) => mockGetDetail(...args),
    getPaymentProofSignedUrl: (...args: unknown[]) => mockGetProof(...args),
    verifyPayment: (...args: unknown[]) => mockVerify(...args),
    rejectPayment: (...args: unknown[]) => mockReject(...args),
  },
}));

import { paymentController } from './payment.controller.js';

const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const PAYMENT_1 = '99999999-9999-4999-8999-999999999999';

function createReqRes(opts: {
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  body?: unknown;
}) {
  const req = {
    ctx: { userId: ACTOR, role: 'agency', agencyId: AGENCY_A },
    query: opts.query ?? {},
    params: opts.params ?? {},
    body: opts.body,
  } as unknown as Request;
  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue({ payments: [], page: 1, limit: 20, total: 0 });
  mockGetDetail.mockResolvedValue({ payment: { id: PAYMENT_1 } });
  mockGetProof.mockResolvedValue({ url: 'https://signed.example/x', expires_in_seconds: 300 });
  mockVerify.mockResolvedValue({ payment_id: PAYMENT_1, status: 'verified' });
  mockReject.mockResolvedValue({ payment_id: PAYMENT_1, status: 'rejected' });
});

describe('PaymentController.list', () => {
  it('applies defaults (page 1, limit 20) and the session agency', async () => {
    const { req, res, next, json } = createReqRes({});

    await paymentController.list(req, res, next);

    expect(mockList).toHaveBeenCalledWith({
      agencyId: AGENCY_A,
      status: undefined,
      page: 1,
      limit: 20,
    });
    expect(json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('passes status filter and pagination through', async () => {
    const { req, res, next } = createReqRes({
      query: { status: 'pending', page: '3', limit: '15' },
    });

    await paymentController.list(req, res, next);

    expect(mockList).toHaveBeenCalledWith({
      agencyId: AGENCY_A,
      status: 'pending',
      page: 3,
      limit: 15,
    });
  });

  it('rejects limit above 50 and invalid status', async () => {
    const tooMany = createReqRes({ query: { limit: '51' } });
    await paymentController.list(tooMany.req, tooMany.res, tooMany.next);
    expect(mockList).not.toHaveBeenCalled();
    expect(tooMany.next).toHaveBeenCalledWith(expect.any(ValidationError));

    const badStatus = createReqRes({ query: { status: 'nope' } });
    await paymentController.list(badStatus.req, badStatus.res, badStatus.next);
    expect(badStatus.next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});

describe('PaymentController.getById / getProof', () => {
  it('validates the paymentId uuid', async () => {
    const { req, res, next } = createReqRes({ params: { paymentId: PAYMENT_1 } });

    await paymentController.getById(req, res, next);

    expect(mockGetDetail).toHaveBeenCalledWith({
      paymentId: PAYMENT_1,
      agencyId: AGENCY_A,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid paymentId', async () => {
    const { req, res, next } = createReqRes({ params: { paymentId: 'not-a-uuid' } });

    await paymentController.getById(req, res, next);

    expect(mockGetDetail).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('getProof uses the session agency', async () => {
    const { req, res, next, json } = createReqRes({ params: { paymentId: PAYMENT_1 } });

    await paymentController.getProof(req, res, next);

    expect(mockGetProof).toHaveBeenCalledWith({
      paymentId: PAYMENT_1,
      agencyId: AGENCY_A,
    });
    expect(json).toHaveBeenCalledWith({
      url: 'https://signed.example/x',
      expires_in_seconds: 300,
    });
  });
});

describe('PaymentController.verify / reject', () => {
  it('verify derives the actor from the session, never from the body', async () => {
    const { req, res, next } = createReqRes({
      params: { paymentId: PAYMENT_1 },
      body: { actor_user_id: 'someone-else', agencyId: 'other' },
    });

    await paymentController.verify(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith({
      paymentId: PAYMENT_1,
      actorUserId: ACTOR,
    });
  });

  it('reject trims the reason and passes the session actor', async () => {
    const { req, res, next } = createReqRes({
      params: { paymentId: PAYMENT_1 },
      body: { reason: '  Monto no coincide  ' },
    });

    await paymentController.reject(req, res, next);

    expect(mockReject).toHaveBeenCalledWith({
      paymentId: PAYMENT_1,
      actorUserId: ACTOR,
      reason: 'Monto no coincide',
    });
  });

  it.each([
    ['empty reason', { reason: '   ' }],
    ['missing reason', {}],
    ['reason over 500 chars', { reason: 'x'.repeat(501) }],
  ])('rejects %s with ValidationError', async (_label, body) => {
    const { req, res, next } = createReqRes({
      params: { paymentId: PAYMENT_1 },
      body,
    });

    await paymentController.reject(req, res, next);

    expect(mockReject).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});
