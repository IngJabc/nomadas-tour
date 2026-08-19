import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../errors/index.js';

const mockCreateLink = vi.fn();
const mockConfirm = vi.fn();
const mockPublicGet = vi.fn();
const mockPublicSave = vi.fn();

vi.mock('../services/reservation-link.service.js', () => ({
  reservationLinkService: {
    createLink: (...args: unknown[]) => mockCreateLink(...args),
    confirm: (...args: unknown[]) => mockConfirm(...args),
    cancel: vi.fn(),
    regenerate: vi.fn(),
    patchData: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    publicGet: (...args: unknown[]) => mockPublicGet(...args),
    publicSave: (...args: unknown[]) => mockPublicSave(...args),
  },
}));

import { reservationLinkController } from '../controllers/reservation-link.controller.js';

function mockRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { json, status, res: { json, status } as unknown as Response };
}

describe('F5-004 ReservationLinkController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create requires trip_id and seat_ids', async () => {
    const { res, json, status } = mockRes();
    const next = vi.fn() as NextFunction;
    const req = {
      body: { trip_id: 'not-uuid', seat_ids: [] },
      ctx: { agencyId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222' },
    } as unknown as Request;
    await reservationLinkController.create(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ValidationError);
    expect(json).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('confirm sends empty body to service', async () => {
    mockConfirm.mockResolvedValueOnce({ reservation_id: 'r1' });
    const { res, json } = mockRes();
    const next = vi.fn() as NextFunction;
    const req = {
      params: { id: '33333333-3333-4333-8333-333333333333' },
      body: { passengers: [{ name: 'should-be-ignored' }] },
      ctx: { agencyId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222' },
    } as unknown as Request;
    await reservationLinkController.confirm(req, res, next);
    expect(mockConfirm).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(json).toHaveBeenCalledWith({ reservation_id: 'r1' });
  });

  it('publicSave validates passengers keyed by seat_code', async () => {
    mockPublicSave.mockResolvedValueOnce({ ok: true });
    const { res, json } = mockRes();
    const next = vi.fn() as NextFunction;
    const req = {
      params: { token: 'a'.repeat(64) },
      body: {
        booker_name: 'Juan',
        passengers: [{ seat_code: 'A1', name: 'Juan', document: '1', phone: '' }],
      },
    } as unknown as Request;
    await reservationLinkController.publicSave(req, res, next);
    expect(mockPublicSave).toHaveBeenCalled();
    expect(json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
