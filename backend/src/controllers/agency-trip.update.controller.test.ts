import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ConflictError, ForbiddenError, ValidationError } from '../errors/index.js';

/**
 * AS-TRIP-004 — `PATCH /api/agency/trips/:tripId`.
 *
 * El schema es el MISMO `strict` que el alta: `agency_ids`, `agency_id`,
 * `status`, `postpone`, `created_by` o cualquier campo no listado se
 * rechaza con 400 (no se "filtra" silenciosamente). El actor y la
 * agencia salen SIEMPRE de `req.ctx`; el tripId de la ruta es solo
 * identificación y nunca prueba de propiedad (eso lo decide el service
 * y la RPC `update_agency_trip`).
 */

const mockUpdateAgencyTrip = vi.fn();
const mockCreateAgencyTrip = vi.fn();
const mockListRoutesCatalog = vi.fn();
const mockUpdateTripStatus = vi.fn();

vi.mock('../services/superadmin.service.js', () => ({
  superadminService: {
    updateAgencyTrip: (...args: unknown[]) => mockUpdateAgencyTrip(...args),
    createAgencyTrip: (...args: unknown[]) => mockCreateAgencyTrip(...args),
    listRoutesCatalog: (...args: unknown[]) => mockListRoutesCatalog(...args),
    updateTripStatus: (...args: unknown[]) => mockUpdateTripStatus(...args),
  },
}));

import { agencyTripController, updateTripSchema } from './agency-trip.controller.js';

const SESSION_AGENCY = {
  userId: 'agency-user',
  role: 'agency' as const,
  agencyId: 'agency-1',
};

const TRIP_ID = '9c1f2a3b-4d5e-4f6a-8b7c-9d0e1f2a3b4c';

const VALID_BODY = {
  route_id: '3f1d2a4c-8b7e-4f9a-9c3d-1e2f3a4b5c6d',
  departure_time: '2027-03-01T07:00',
  vehicle_type: 'bus' as const,
};

function createReqRes(opts: { body?: unknown; ctx?: unknown; tripId?: string } = {}) {
  const req = {
    ctx: opts.ctx === undefined ? SESSION_AGENCY : opts.ctx,
    body: opts.body,
    params: { tripId: opts.tripId ?? TRIP_ID },
  } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status, json } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next, json, status };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateAgencyTrip.mockResolvedValue({ id: TRIP_ID, status: 'active' });
});

describe('agencyTripController.updateTrip (AS-TRIP-004)', () => {
  it('edita con el ctx de la sesión y el tripId de la ruta, y responde 200', async () => {
    const { req, res, next, json } = createReqRes({ body: VALID_BODY });

    await agencyTripController.updateTrip(req, res, next);

    expect(mockUpdateAgencyTrip).toHaveBeenCalledWith(SESSION_AGENCY, TRIP_ID, {
      route_id: VALID_BODY.route_id,
      departure_time: VALID_BODY.departure_time,
      vehicle_type: 'bus',
    });
    expect(json).toHaveBeenCalledWith({ id: TRIP_ID, status: 'active' });
    expect(next).not.toHaveBeenCalled();
  });

  it('envía el precio por asiento cuando está presente', async () => {
    const { req, res, next } = createReqRes({
      body: { ...VALID_BODY, seat_price: 25000000 },
    });

    await agencyTripController.updateTrip(req, res, next);

    expect(mockUpdateAgencyTrip).toHaveBeenCalledWith(
      SESSION_AGENCY,
      TRIP_ID,
      expect.objectContaining({ seat_price: 25000000 }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['agency_ids (viaje compartido)', { agency_ids: ['agency-2', 'agency-3'] }],
    ['agency_id (spoof)', { agency_id: 'agency-2' }],
    ['agencyId (spoof)', { agencyId: 'agency-2' }],
    ['status (cambio de estado prohibido)', { status: 'completed' }],
    ['created_by (impersonación)', { created_by: 'someone-else' }],
    ['actor_user_id (actor spoof)', { actor_user_id: 'superadmin-user' }],
    ['postpone', { postpone: true }],
    ['is_published (campo ajeno)', { is_published: false }],
  ])('rechaza el campo extra %s sin llamar al service', async (_label, extra) => {
    const { req, res, next } = createReqRes({ body: { ...VALID_BODY, ...extra } });

    await agencyTripController.updateTrip(req, res, next);

    expect(mockUpdateAgencyTrip).not.toHaveBeenCalled();
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

    await agencyTripController.updateTrip(req, res, next);

    expect(mockUpdateAgencyTrip).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('propaga errores de autorización del service por next()', async () => {
    mockUpdateAgencyTrip.mockRejectedValue(
      new ForbiddenError('El viaje no pertenece en exclusiva a tu agencia'),
    );
    const { req, res, next } = createReqRes({ body: VALID_BODY });

    await agencyTripController.updateTrip(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it('propaga el 409 de reservas existentes por next()', async () => {
    mockUpdateAgencyTrip.mockRejectedValue(
      new ConflictError('No se puede editar un viaje con 2 reserva(s) registrada(s)'),
    );
    const { req, res, next } = createReqRes({ body: VALID_BODY });

    await agencyTripController.updateTrip(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ConflictError));
  });
});

describe('updateTripSchema — contrato estricto', () => {
  it('acepta el payload mínimo de la UI', () => {
    expect(updateTripSchema.safeParse(VALID_BODY).success).toBe(true);
  });

  it('es el mismo contrato que el alta: solo ruta, salida, vehículo y precio', () => {
    expect(
      updateTripSchema.safeParse({ ...VALID_BODY, seat_price: 15000 }).success,
    ).toBe(true);
  });

  it('rechaza agency_ids aunque sea un array vacío', () => {
    expect(
      updateTripSchema.safeParse({ ...VALID_BODY, agency_ids: [] }).success,
    ).toBe(false);
    expect(
      updateTripSchema.safeParse({ ...VALID_BODY, agency_ids: ['agency-2'] })
        .success,
    ).toBe(false);
  });

  it('no acepta claves desconocidas (strict)', () => {
    expect(
      updateTripSchema.safeParse({ ...VALID_BODY, cualquier_cosa: 1 }).success,
    ).toBe(false);
  });
});
