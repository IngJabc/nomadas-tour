import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, ValidationError } from '../errors/index.js';

/**
 * AS-TRIP-003 — `POST /api/agency/trips` y `GET /api/agency/routes`.
 *
 * El schema es **strict**: `agency_ids`, `agency_id`, `status` o cualquier
 * campo no listado se rechaza con 400 (no se "filtra" silenciosamente).
 * La identidad de la agencia sale SIEMPRE de `req.ctx`; el body nunca
 * puede asignar el viaje a otra agencia ni crear viajes compartidos.
 */

const mockCreateAgencyTrip = vi.fn();
const mockListRoutesCatalog = vi.fn();
const mockUpdateTripStatus = vi.fn();

vi.mock('../services/superadmin.service.js', () => ({
  superadminService: {
    createAgencyTrip: (...args: unknown[]) => mockCreateAgencyTrip(...args),
    listRoutesCatalog: (...args: unknown[]) => mockListRoutesCatalog(...args),
    updateTripStatus: (...args: unknown[]) => mockUpdateTripStatus(...args),
  },
}));

import { agencyTripController, createTripSchema } from './agency-trip.controller.js';

const SESSION_AGENCY = {
  userId: 'agency-user',
  role: 'agency' as const,
  agencyId: 'agency-1',
};

const VALID_BODY = {
  route_id: '3f1d2a4c-8b7e-4f9a-9c3d-1e2f3a4b5c6d',
  departure_time: '2027-03-01T07:00',
  vehicle_type: 'bus' as const,
};

function createReqRes(opts: { body?: unknown; ctx?: unknown } = {}) {
  const req = {
    ctx: opts.ctx === undefined ? SESSION_AGENCY : opts.ctx,
    body: opts.body,
  } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status, json } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next, json, status };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAgencyTrip.mockResolvedValue({ id: 'trip-new', status: 'active' });
  mockListRoutesCatalog.mockResolvedValue([
    { id: 'route-1', origin: 'Caracas', destination: 'Mérida', status: 'active' },
  ]);
});

describe('agencyTripController.createTrip (AS-TRIP-003)', () => {
  it('crea el viaje con el ctx de la sesión y responde 201', async () => {
    const { req, res, next, status } = createReqRes({ body: VALID_BODY });

    await agencyTripController.createTrip(req, res, next);

    expect(mockCreateAgencyTrip).toHaveBeenCalledWith(SESSION_AGENCY, {
      route_id: VALID_BODY.route_id,
      departure_time: VALID_BODY.departure_time,
      vehicle_type: 'bus',
    });
    expect(status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  it('envía el precio por asiento cuando está presente', async () => {
    const { req, res, next } = createReqRes({
      body: { ...VALID_BODY, seat_price: 25000000 },
    });

    await agencyTripController.createTrip(req, res, next);

    expect(mockCreateAgencyTrip).toHaveBeenCalledWith(
      SESSION_AGENCY,
      expect.objectContaining({ seat_price: 25000000 }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['agency_ids (viaje compartido)', { agency_ids: ['agency-2', 'agency-3'] }],
    ['agency_id (spoof)', { agency_id: 'agency-2' }],
    ['agencyId (spoof)', { agencyId: 'agency-2' }],
    ['status no soportado', { status: 'inactive' }],
    ['created_by (impersonación)', { created_by: 'someone-else' }],
    ['actor_user_id', { actor_user_id: 'superadmin-user' }],
    ['postpone', { postpone: true }],
  ])('rechaza el campo extra %s sin llamar al service', async (_label, extra) => {
    const { req, res, next } = createReqRes({ body: { ...VALID_BODY, ...extra } });

    await agencyTripController.createTrip(req, res, next);

    expect(mockCreateAgencyTrip).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it.each([
    ['vehicle_type inválido', { vehicle_type: 'van' }],
    ['route_id sin uuid', { route_id: 'no-uuid' }],
    ['departure_time mal formada', { departure_time: 'mañana' }],
    ['seat_price no entero', { seat_price: 10.5 }],
    ['seat_price negativo', { seat_price: -1 }],
    ['campo faltante (sin route_id)', { route_id: undefined }],
  ])('rechaza %s', async (_label, patch) => {
    const { req, res, next } = createReqRes({
      body: { ...VALID_BODY, ...patch },
    });

    await agencyTripController.createTrip(req, res, next);

    expect(mockCreateAgencyTrip).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('propaga errores de autorización del service por next()', async () => {
    mockCreateAgencyTrip.mockRejectedValue(
      new ForbiddenError('Solo las agencias pueden crear viajes'),
    );
    const { req, res, next } = createReqRes({ body: VALID_BODY });

    await agencyTripController.createTrip(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });
});

describe('createTripSchema — contrato estricto', () => {
  it('acepta el payload mínimo de la UI', () => {
    const result = createTripSchema.safeParse(VALID_BODY);
    expect(result.success).toBe(true);
  });

  it('rechaza agency_ids aunque sea un array vacío', () => {
    expect(
      createTripSchema.safeParse({ ...VALID_BODY, agency_ids: [] }).success,
    ).toBe(false);
    expect(
      createTripSchema.safeParse({ ...VALID_BODY, agency_ids: ['agency-2'] })
        .success,
    ).toBe(false);
  });

  it('no acepta claves desconocidas (strict)', () => {
    expect(
      createTripSchema.safeParse({ ...VALID_BODY, cualquier_cosa: 1 }).success,
    ).toBe(false);
  });
});

describe('agencyTripController.listRoutes', () => {
  it('devuelve el catálogo global de rutas (solo lectura)', async () => {
    const { req, res, next, json } = createReqRes({});

    await agencyTripController.listRoutes(req, res, next);

    expect(mockListRoutesCatalog).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith([
      { id: 'route-1', origin: 'Caracas', destination: 'Mérida', status: 'active' },
    ]);
    expect(next).not.toHaveBeenCalled();
  });

  it('propaga errores del service por next()', async () => {
    mockListRoutesCatalog.mockRejectedValue(new ValidationError('boom'));
    const { req, res, next } = createReqRes({});

    await agencyTripController.listRoutes(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});
