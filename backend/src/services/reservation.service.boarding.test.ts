/**
 * AUD-020 P2 — Backend boarding contract tests.
 * Exact lookup, RPC toggle mapping, attempts telemetry (best-effort).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const mockRpc = vi.fn();
const mockRecordBoardingAttempt = vi.fn(async () => undefined);
const callQueues: Record<string, Array<() => any>> = {};

function nextFrom(table: string) {
  const queue = callQueues[table];
  if (!queue || queue.length === 0) {
    throw new Error(`Unexpected supabaseAdmin.from('${table}') — queue empty`);
  }
  return queue.shift()!();
}

function queueFrom(table: string, builders: Array<() => any>) {
  callQueues[table] = [...builders];
}

function createFilterChain(terminal: () => Promise<{ data: any; error: any }>) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.or = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.single = vi.fn(() => terminal());
  chain.maybeSingle = vi.fn(() => terminal());
  chain.then = vi.fn((resolve: (value: { data: any; error: any }) => void) => {
    terminal().then(resolve);
  });
  return chain;
}

function readSingle(data: any, error: any = null) {
  return () => createFilterChain(() => Promise.resolve({ data, error }));
}

function readList(data: any, error: any = null) {
  return () => createFilterChain(() => Promise.resolve({ data, error }));
}

vi.mock('../config/env.js', () => ({
  env: {
    SUPABASE_URL: 'http://localhost:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    JWT_SECRET: 'test-jwt-secret',
    PORT: 3001,
    NODE_ENV: 'test',
    CORS_ORIGIN: 'http://localhost:3000',
    RESEND_API_KEY: 'test-resend',
    EMAIL_FROM: 'test@example.com',
    FRONTEND_URL: 'http://localhost:3000',
    LOCK_TTL_SECONDS: 300,
  },
}));

vi.mock('../config/database.js', () => ({
  get supabaseAdmin() {
    return {
      from: (table: string) => nextFrom(table),
      rpc: mockRpc,
    };
  },
}));

vi.mock('./boarding-attempts.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./boarding-attempts.service.js')>();
  return {
    ...actual,
    recordBoardingAttempt: mockRecordBoardingAttempt,
  };
});

vi.mock('./notification.service.js', () => ({
  notificationService: {
    createForAgenciesAndAdmin: vi.fn(() => Promise.resolve(undefined)),
  },
}));

vi.mock('./email.service.js', () => ({
  emailService: {
    sendReservationConfirmedEmail: vi.fn(),
  },
}));

vi.mock('../utils/qr.js', () => ({
  generateQRContent: vi.fn(),
  generateQRDataURL: vi.fn(async () => 'data:image/png;base64,xx'),
}));

import { reservationService } from './reservation.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';

const AGENCY_ID = 'agency-op-1';
const ACTOR_ID = 'user-1';
const PAST = new Date(Date.now() - 86_400_000).toISOString();
const QR = 'NT-LA OLLA-6BBD52E983AB495493EAEE20466C18A2';
const TICKET = '6BBD52E9';

function baseReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    trip_id: 'trip-1',
    status: 'confirmed',
    ticket_code: TICKET,
    qr_code: QR,
    agencies: { name: 'Agencia Propietaria' },
    ...overrides,
  };
}

function queueSuccessfulLookup(reservation = baseReservation()) {
  queueFrom('reservations', [readSingle(reservation)]);
  queueFrom('trip_agencies', [readSingle({ id: 'ta-1' })]);
  queueFrom('trips', [
    readSingle({
      id: 'trip-1',
      departure_time: PAST,
      status: 'active',
      routes: { origin: 'Caracas', destination: 'La Olla' },
    }),
  ]);
  queueFrom('reservation_passengers', [
    readList([
      {
        id: 'pax-1',
        name: 'Pedro Pasajero',
        boarded: false,
        boarded_at: null,
        seats: { seat_code: 'A1' },
      },
    ]),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(callQueues)) {
    delete callQueues[key];
  }
  mockRpc.mockReset();
  mockRecordBoardingAttempt.mockResolvedValue(undefined);
});

function expectDeniedInvariants(response: {
  found: boolean;
  allowed: boolean;
  failure_code: string | null;
  result: unknown;
}) {
  expect(response.allowed).toBe(false);
  expect(response.failure_code).not.toBeNull();
  expect(response.result).toBeNull();
  if (response.allowed) {
    expect(response.found).toBe(true);
  }
}

describe('AUD-020.9 — lookupPassengerByQR envelope', () => {
  it('EMPTY_INPUT', async () => {
    const response = await reservationService.lookupPassengerByQR(
      '   ',
      AGENCY_ID,
      ACTOR_ID,
    );

    expectDeniedInvariants(response);
    expect(response).toEqual({
      found: false,
      allowed: false,
      failure_code: 'EMPTY_INPUT',
      result: null,
    });
  });

  it('CREDENTIAL_NOT_FOUND for missing ticket / fragments', async () => {
    queueFrom('reservations', [readSingle(null)]);

    const response = await reservationService.lookupPassengerByQR(
      'OLLA',
      AGENCY_ID,
      ACTOR_ID,
    );

    expectDeniedInvariants(response);
    expect(response.found).toBe(false);
    expect(response.failure_code).toBe('CREDENTIAL_NOT_FOUND');
    expect(mockRecordBoardingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'lookup',
        outcome: 'not_found',
        failure_code: 'CREDENTIAL_NOT_FOUND',
      }),
    );
  });

  it('TRIP_NOT_DEPARTED when credential exists but trip has not departed', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    queueFrom('reservations', [readSingle(baseReservation())]);
    queueFrom('trip_agencies', [readSingle({ id: 'ta-1' })]);
    queueFrom('trips', [
      readSingle({
        id: 'trip-1',
        departure_time: future,
        status: 'active',
        routes: { origin: 'A', destination: 'B' },
      }),
    ]);

    const response = await reservationService.lookupPassengerByQR(
      TICKET,
      AGENCY_ID,
      ACTOR_ID,
    );

    expectDeniedInvariants(response);
    expect(response.found).toBe(true);
    expect(response.failure_code).toBe('TRIP_NOT_DEPARTED');
    expect(JSON.stringify(response)).not.toContain('document');
    expect(JSON.stringify(response)).not.toContain('qr_code');
  });

  it('AGENCY_NOT_ASSIGNED when operator agency is not on the trip', async () => {
    queueFrom('reservations', [readSingle(baseReservation())]);
    queueFrom('trip_agencies', [readSingle(null)]);

    const response = await reservationService.lookupPassengerByQR(
      TICKET,
      AGENCY_ID,
      ACTOR_ID,
    );

    expectDeniedInvariants(response);
    expect(response.found).toBe(true);
    expect(response.failure_code).toBe('AGENCY_NOT_ASSIGNED');
  });

  it('RESERVATION_CANCELLED when reservation is cancelled', async () => {
    queueFrom('reservations', [
      readSingle(baseReservation({ status: 'cancelled' })),
    ]);

    const response = await reservationService.lookupPassengerByQR(
      TICKET,
      AGENCY_ID,
      ACTOR_ID,
    );

    expectDeniedInvariants(response);
    expect(response.found).toBe(true);
    expect(response.failure_code).toBe('RESERVATION_CANCELLED');
  });

  it('allowed ticket_code returns minimal DTO in result', async () => {
    queueSuccessfulLookup();

    const response = await reservationService.lookupPassengerByQR(
      TICKET,
      AGENCY_ID,
      ACTOR_ID,
    );

    expect(response.found).toBe(true);
    expect(response.allowed).toBe(true);
    expect(response.failure_code).toBeNull();
    expect(response.result).toEqual({
      trip: {
        id: 'trip-1',
        status: 'active',
        departure_time: PAST,
        route: { origin: 'Caracas', destination: 'La Olla' },
      },
      reservation_status: 'confirmed',
      reservation_agency_name: 'Agencia Propietaria',
      passengers: [
        {
          id: 'pax-1',
          name: 'Pedro Pasajero',
          seat_code: 'A1',
          boarded: false,
          boarded_at: null,
        },
      ],
    });
    expect(response.result).not.toHaveProperty('qr_code');
    expect(response.result).not.toHaveProperty('booker_document');
    expect(response.result!.passengers[0]).not.toHaveProperty('document');
  });

  it('allowed qr_code exact match', async () => {
    queueSuccessfulLookup();

    const response = await reservationService.lookupPassengerByQR(
      QR,
      AGENCY_ID,
      ACTOR_ID,
    );

    expect(response.allowed).toBe(true);
    expect(response.found).toBe(true);
    expect(response.failure_code).toBeNull();
    expect(response.result?.passengers[0].seat_code).toBe('A1');
  });
});

describe('AUD-020 P2 — toggleBoarding (RPC)', () => {
  it('boards via boarding_toggle and maps changed=true', async () => {
    mockRpc.mockResolvedValue({
      data: {
        passenger_id: 'pax-1',
        boarded: true,
        boarded_at: PAST,
        changed: true,
        reservation_status: 'completed',
        boarded_count: 1,
        total_count: 1,
      },
      error: null,
    });

    const result = await reservationService.toggleBoarding(
      'pax-1',
      true,
      ACTOR_ID,
      AGENCY_ID,
    );

    expect(mockRpc).toHaveBeenCalledWith('boarding_toggle', {
      p_passenger_id: 'pax-1',
      p_boarded: true,
      p_actor_user_id: ACTOR_ID,
      p_operator_agency_id: AGENCY_ID,
    });

    expect(result).toEqual({
      passenger_id: 'pax-1',
      boarded: true,
      boarded_at: PAST,
      changed: true,
      reservation_status: 'completed',
      boarded_count: 1,
      total_count: 1,
    });

    expect(mockRecordBoardingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'board',
        outcome: 'success',
      }),
    );
  });

  it('unboards via RPC', async () => {
    mockRpc.mockResolvedValue({
      data: {
        passenger_id: 'pax-1',
        boarded: false,
        boarded_at: null,
        changed: true,
        reservation_status: 'confirmed',
        boarded_count: 0,
        total_count: 1,
      },
      error: null,
    });

    const result = await reservationService.toggleBoarding(
      'pax-1',
      false,
      ACTOR_ID,
      AGENCY_ID,
    );

    expect(result.boarded).toBe(false);
    expect(result.changed).toBe(true);
    expect(mockRecordBoardingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'unboard', outcome: 'success' }),
    );
  });

  it('maps no-op board=true when already boarded (changed=false)', async () => {
    mockRpc.mockResolvedValue({
      data: {
        passenger_id: 'pax-1',
        boarded: true,
        boarded_at: PAST,
        changed: false,
        reservation_status: 'completed',
        boarded_count: 1,
        total_count: 1,
      },
      error: null,
    });

    const result = await reservationService.toggleBoarding(
      'pax-1',
      true,
      ACTOR_ID,
      AGENCY_ID,
    );

    expect(result.changed).toBe(false);
    expect(result.boarded).toBe(true);
    expect(mockRecordBoardingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'no_change' }),
    );
  });

  it('maps no-op board=false when already unboarded (changed=false)', async () => {
    mockRpc.mockResolvedValue({
      data: {
        passenger_id: 'pax-1',
        boarded: false,
        boarded_at: null,
        changed: false,
        reservation_status: 'confirmed',
        boarded_count: 0,
        total_count: 1,
      },
      error: null,
    });

    const result = await reservationService.toggleBoarding(
      'pax-1',
      false,
      ACTOR_ID,
      AGENCY_ID,
    );

    expect(result.changed).toBe(false);
    expect(result.boarded).toBe(false);
  });

  it('maps agency not assigned to ForbiddenError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Tu agencia no está asignada a este viaje' },
    });

    await expect(
      reservationService.toggleBoarding('pax-1', true, ACTOR_ID, AGENCY_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockRecordBoardingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'denied' }),
    );
  });

  it('maps invalid trip to ValidationError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Este viaje ya fue completado. No es posible realizar boarding.' },
    });

    await expect(
      reservationService.toggleBoarding('pax-1', true, ACTOR_ID, AGENCY_ID),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('maps cancelled passenger to ValidationError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'No se puede abordar un pasajero cancelado' },
    });

    await expect(
      reservationService.toggleBoarding('pax-1', true, ACTOR_ID, AGENCY_ID),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('maps missing passenger to NotFoundError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Pasajero no encontrado' },
    });

    await expect(
      reservationService.toggleBoarding('pax-missing', true, ACTOR_ID, AGENCY_ID),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

});

describe('AUD-020 P2 — boarding_attempts helper', () => {
  it('hashes credentials without storing plaintext', async () => {
    const { hashBoardingCredential } = await import('./boarding-attempts.service.js');
    const hash = hashBoardingCredential(TICKET);
    expect(hash).toBe(
      createHash('sha256').update(TICKET, 'utf8').digest('hex'),
    );
    expect(hash).not.toContain(TICKET);
  });
});
