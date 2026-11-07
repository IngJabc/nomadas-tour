/**
 * PAY-NOTIFICATIONS Task 2 — contrato HTTP del controller de verify/reject.
 *
 * Bloquea:
 *   - `res.json` recibe EXACTAMENTE el `result` del RPC (sin `customer_id`
 *     ni `customerId`): el contrato de respuesta queda byte-idéntico;
 *   - el service recibe el attemptId y el actorUserId del contexto
 *     (nunca un customer_id del input del cliente);
 *   - los errores se propagan vía `next` sin responder con `res.json`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const VERIFY_RESULT = {
  attempt_id: '11111111-1111-4111-8111-111111111111',
  status: 'verified',
  already_verified: false,
  reservation_id: '44444444-4444-4444-8444-444444444444',
};

const REJECT_RESULT = {
  attempt_id: '11111111-1111-4111-8111-111111111111',
  status: 'rejected',
  already_rejected: false,
  final: false,
};

const mockVerify = vi.fn();
const mockReject = vi.fn();

vi.mock('../services/checkout-attempt.service.js', () => ({
  checkoutAttemptService: {
    verify: (...args: unknown[]) => mockVerify(...args),
    reject: (...args: unknown[]) => mockReject(...args),
  },
}));

import { checkoutAttemptController } from './checkout-attempt.controller.js';

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';

function createMocks() {
  const res = {
    json: vi.fn(),
  };
  const next = vi.fn();
  return { res, next };
}

function verifyReq(overrides: Partial<Request> = {}): Request {
  return {
    params: { attemptId: ATTEMPT_ID },
    ctx: { userId: ACTOR_ID },
    ...overrides,
  } as unknown as Request;
}

function rejectReq(reason = 'El comprobante no coincide con el monto'): Request {
  return {
    params: { attemptId: ATTEMPT_ID },
    body: { reason },
    ctx: { userId: ACTOR_ID },
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkoutAttemptController.verify — contrato HTTP (Task 2)', () => {
  it('serializa solo el result del RPC, sin customer_id/customerId', async () => {
    mockVerify.mockResolvedValue({ result: VERIFY_RESULT, customerId: CUSTOMER_ID });
    const { res, next } = createMocks();

    await checkoutAttemptController.verify(verifyReq(), res as unknown as Response, next as NextFunction);

    // Debe enviar exactamente el result: ningún identificador de cliente.
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(VERIFY_RESULT);
    expect(res.json).toHaveBeenCalledWith(
      expect.not.objectContaining({ customer_id: expect.anything() }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.not.objectContaining({ customerId: expect.anything() }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('pasa attemptId y actorUserId del contexto; nunca acepta un customer_id del cliente', async () => {
    mockVerify.mockResolvedValue({ result: VERIFY_RESULT, customerId: CUSTOMER_ID });
    const { res, next } = createMocks();

    const req = verifyReq({
      body: { customer_id: CUSTOMER_ID },
    } as Partial<Request>);

    await checkoutAttemptController.verify(req, res as unknown as Response, next as NextFunction);

    expect(mockVerify).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID,
      actorUserId: ACTOR_ID,
    });
    expect(mockVerify.mock.calls[0][0]).not.toHaveProperty('customerId');
    expect(mockVerify.mock.calls[0][0]).not.toHaveProperty('customer_id');
  });

  it('propaga errores del service vía next sin responder', async () => {
    const boom = new Error('forbidden');
    mockVerify.mockRejectedValue(boom);
    const { res, next } = createMocks();

    await checkoutAttemptController.verify(verifyReq(), res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('checkoutAttemptController.reject — contrato HTTP (Task 2)', () => {
  it('serializa solo el result del RPC, sin customer_id/customerId', async () => {
    mockReject.mockResolvedValue({ result: REJECT_RESULT, customerId: CUSTOMER_ID });
    const { res, next } = createMocks();

    await checkoutAttemptController.reject(rejectReq(), res as unknown as Response, next as NextFunction);

    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(REJECT_RESULT);
    expect(res.json).toHaveBeenCalledWith(
      expect.not.objectContaining({ customer_id: expect.anything() }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.not.objectContaining({ customerId: expect.anything() }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('pasa attemptId, actorUserId y reason; nunca acepta un customer_id del cliente', async () => {
    mockReject.mockResolvedValue({ result: REJECT_RESULT, customerId: CUSTOMER_ID });
    const { res, next } = createMocks();

    const req = rejectReq();
    (req as unknown as Record<string, unknown>).body = {
      reason: 'El comprobante no coincide con el monto',
      customer_id: CUSTOMER_ID,
    };

    await checkoutAttemptController.reject(req, res as unknown as Response, next as NextFunction);

    expect(mockReject).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID,
      actorUserId: ACTOR_ID,
      reason: 'El comprobante no coincide con el monto',
    });
    expect(mockReject.mock.calls[0][0]).not.toHaveProperty('customerId');
    expect(mockReject.mock.calls[0][0]).not.toHaveProperty('customer_id');
  });

  it('propaga errores del service vía next sin responder', async () => {
    const boom = new Error('conflict');
    mockReject.mockRejectedValue(boom);
    const { res, next } = createMocks();

    await checkoutAttemptController.reject(rejectReq(), res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});
