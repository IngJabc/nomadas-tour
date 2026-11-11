import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ValidationError } from '../errors/index.js';

/**
 * El actor de una transición de estado de viaje se deriva SIEMPRE de
 * `req.ctx` (sesión autenticada + public.users). Un `actor_user_id`
 * llegado en el body, la query o los headers se ignora por completo.
 */

const mockUpdateTripStatus = vi.fn();
const mockArchiveTrip = vi.fn();

vi.mock('../services/superadmin.service.js', () => ({
  superadminService: {
    updateTripStatus: (...args: unknown[]) => mockUpdateTripStatus(...args),
    archiveTrip: (...args: unknown[]) => mockArchiveTrip(...args),
  },
}));

import { superadminController } from './superadmin.controller.js';
import { agencyTripController } from './agency-trip.controller.js';

const SESSION = {
  userId: 'session-user',
  role: 'superadmin' as const,
  agencyId: null as string | null,
};

const SESSION_AGENCY = {
  userId: 'agency-user',
  role: 'agency' as const,
  agencyId: 'agency-1',
};

function createReqRes(opts: {
  params?: Record<string, string>;
  body?: unknown;
  ctx?: Record<string, unknown>;
}) {
  const req = {
    ctx: opts.ctx === undefined ? SESSION : opts.ctx,
    params: opts.params ?? { id: 'trip-1' },
    body: opts.body,
  } as unknown as Request;
  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateTripStatus.mockResolvedValue({ id: 'trip-1', status: 'completed' });
  mockArchiveTrip.mockResolvedValue({ id: 'trip-1', status: 'archived' });
});

describe('superadminController.updateTripStatus', () => {
  it('uses the session actor and ignores a spoofed body actor', async () => {
    const { req, res, next, json } = createReqRes({
      body: { status: 'completed', actor_user_id: 'someone-else' },
    });

    await superadminController.updateTripStatus(req, res, next);

    expect(mockUpdateTripStatus).toHaveBeenCalledWith(
      'trip-1',
      'completed',
      SESSION,
    );
    expect(json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an unsupported status', async () => {
    const { req, res, next } = createReqRes({ body: { status: 'archived' } });

    await superadminController.updateTripStatus(req, res, next);

    expect(mockUpdateTripStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('passes the actor from the session even when the body carries one', async () => {
    const { req, res, next } = createReqRes({
      body: { status: 'cancelled', actor_user_id: 'other-user', agencyId: 'x' },
      ctx: SESSION_AGENCY,
    });

    await superadminController.updateTripStatus(req, res, next);

    expect(mockUpdateTripStatus).toHaveBeenCalledWith(
      'trip-1',
      'cancelled',
      SESSION_AGENCY,
    );
  });
});

describe('superadminController.archiveTrip', () => {
  it('passes the session actor (archivar es superadmin-only)', async () => {
    const { req, res, next } = createReqRes({
      params: { id: 'trip-1' },
      body: {},
    });

    await superadminController.archiveTrip(req, res, next);

    expect(mockArchiveTrip).toHaveBeenCalledWith('trip-1', SESSION);
  });
});

describe('agencyTripController.updateTripStatus', () => {
  it('only accepts completed: cancelar un viaje entero no está disponible', async () => {
    const { req, res, next } = createReqRes({
      params: { tripId: 'trip-1' },
      body: { status: 'cancelled' },
      ctx: SESSION_AGENCY,
    });

    await agencyTripController.updateTripStatus(req, res, next);

    expect(mockUpdateTripStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('uses the agency session actor and ignores a spoofed body actor', async () => {
    const { req, res, next, json } = createReqRes({
      params: { tripId: 'trip-1' },
      body: { status: 'completed', actor_user_id: 'superadmin-user' },
      ctx: SESSION_AGENCY,
    });

    await agencyTripController.updateTripStatus(req, res, next);

    expect(mockUpdateTripStatus).toHaveBeenCalledWith(
      'trip-1',
      'completed',
      SESSION_AGENCY,
    );
    expect(json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('propagates authorization errors through next()', async () => {
    const { ForbiddenError } = await import('../errors/index.js');
    mockUpdateTripStatus.mockRejectedValue(
      new ForbiddenError('El viaje no pertenece en exclusiva a tu agencia'),
    );

    const { req, res, next } = createReqRes({
      params: { tripId: 'trip-1' },
      body: { status: 'completed' },
      ctx: SESSION_AGENCY,
    });

    await agencyTripController.updateTripStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });
});
