import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  TRIP_EFFECTS_VIA_OUTBOX: false,
  EMAIL_VIA_OUTBOX: false,
}));

const mockRpc = vi.hoisted(() => vi.fn());
const mockCreateForAgency = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(undefined)),
);

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

function createFilterChain(terminal: () => Promise<{ data: any; error: any; count?: number }>) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.single = vi.fn(() => terminal());
  chain.maybeSingle = vi.fn(() => terminal());
  chain.then = vi.fn((resolve: (value: { data: any; error: any; count?: number }) => void) => {
    terminal().then(resolve);
  });
  return chain;
}

function readSingle(data: any, error: any = null) {
  return () => createFilterChain(() => Promise.resolve({ data, error }));
}

function readCount(count: number) {
  return () =>
    createFilterChain(() => Promise.resolve({ data: null, error: null, count }));
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
    get EMAIL_VIA_OUTBOX() {
      return mockEnv.EMAIL_VIA_OUTBOX;
    },
    get TRIP_EFFECTS_VIA_OUTBOX() {
      return mockEnv.TRIP_EFFECTS_VIA_OUTBOX;
    },
    OUTBOX_POLL_MS: 2000,
    OUTBOX_BATCH_SIZE: 10,
    OUTBOX_MAX_ATTEMPTS: 10,
    OUTBOX_SETTLE_MS: 5000,
    OUTBOX_RETRY_BASE_MS: 2000,
    OUTBOX_HEARTBEAT_MS: 30_000,
    OUTBOX_STALE_PROCESSING_MS: 300_000,
    OUTBOX_STALE_RECOVERY_LIMIT: 50,
    OUTBOX_RECOVERY_INTERVAL_MS: 60_000,
    SENTRY_ENABLED: false,
    SENTRY_DSN: '',
    SENTRY_ENVIRONMENT: '',
    SENTRY_RELEASE: '',
    WORKER_HEALTH_PORT: 3002,
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

vi.mock('./notification.service.js', () => ({
  notificationService: {
    createForAgency: mockCreateForAgency,
    createForAgenciesAndAdmin: vi.fn(() => Promise.resolve(undefined)),
  },
}));

vi.mock('./email.service.js', () => ({
  emailService: {
    sendReservationConfirmationEmail: vi.fn(),
  },
}));

vi.mock('../utils/qr.js', () => ({
  generateQRContent: vi.fn(),
  generateQRDataURL: vi.fn(async () => 'data:image/png;base64,xx'),
}));

vi.mock('./boarding-attempts.service.js', () => ({
  hashBoardingCredential: vi.fn(),
  recordBoardingAttempt: vi.fn(async () => undefined),
}));

import { reservationService } from './reservation.service.js';
import { notificationService } from './notification.service.js';
import { ConflictError } from '../errors/index.js';

const TRIP_ID = 'trip-1';
const AGENCY_ID = 'agency-1';
const USER_ID = 'user-1';
const RES_ID = 'res-1';
const SEAT_ID = 'seat-1';

function setupCreateAgencyReservationHappyPath() {
  queueFrom('trips', [
    readSingle({ id: TRIP_ID, capacity: 31 }),
    readSingle({ routes: { origin: 'Caracas', destination: 'Mérida' } }),
  ]);
  queueFrom('trip_agencies', [readSingle({ id: 'alloc-1' })]);
  queueFrom('seats', [readCount(10), readCount(0)]);
  queueFrom('reservations', [
    readSingle({
      id: RES_ID,
      trip_id: TRIP_ID,
      agency_id: AGENCY_ID,
      booker_name: 'Ana Pérez',
      reservation_passengers: [
        { id: 'p1', seat_id: SEAT_ID, name: 'Ana', seats: { seat_code: 'A1' } },
        { id: 'p2', seat_id: 'seat-2', name: 'Luis', seats: { seat_code: 'A2' } },
      ],
    }),
  ]);

  mockRpc.mockResolvedValue({
    data: { reservation_id: RES_ID, qr_code: 'ABCDEF12' },
    error: null,
  });
}

beforeEach(() => {
  for (const key of Object.keys(callQueues)) {
    delete callQueues[key];
  }
  mockEnv.TRIP_EFFECTS_VIA_OUTBOX = false;
  mockEnv.EMAIL_VIA_OUTBOX = false;
  mockRpc.mockReset();
  mockCreateForAgency.mockClear();
});

describe('WKR-007 C4 F1 — reservation.created notification gate', () => {
  it('flag=false keeps legacy createForAgency notification', async () => {
    mockEnv.TRIP_EFFECTS_VIA_OUTBOX = false;
    setupCreateAgencyReservationHappyPath();

    const result = await reservationService.createAgencyReservation(
      TRIP_ID,
      'Ana Pérez',
      'V123',
      null,
      [
        { seat_id: SEAT_ID, name: 'Ana', document: 'V1', phone: null },
        { seat_id: 'seat-2', name: 'Luis', document: 'V2', phone: null },
      ],
      AGENCY_ID,
      USER_ID,
    );

    expect(result.reservation.id).toBe(RES_ID);
    expect(result.qr_code).toBe('ABCDEF12');
    expect(mockRpc).toHaveBeenCalledWith(
      'create_agency_reservation',
      expect.objectContaining({
        p_trip_id: TRIP_ID,
        p_agency_id: AGENCY_ID,
        p_booker_name: 'Ana Pérez',
      }),
    );
    expect(notificationService.createForAgency).toHaveBeenCalledOnce();
    expect(notificationService.createForAgency).toHaveBeenCalledWith({
      type: 'reservation_created',
      title: 'Nueva reserva',
      body: 'Ana Pérez realizó una reserva de 2 pasajeros para Caracas → Mérida',
      entityType: 'reservation',
      entityId: RES_ID,
      agencyId: AGENCY_ID,
      actor: 'agency',
      action_url: `/admin/bookings/${RES_ID}`,
      metadata: {
        reservation_id: RES_ID,
        trip_id: TRIP_ID,
        booker_name: 'Ana Pérez',
        passenger_count: 2,
        origin: 'Caracas',
        destination: 'Mérida',
      },
    });
  });

  it('flag=true skips legacy createForAgency so NotificationFanout is sole emitter', async () => {
    mockEnv.TRIP_EFFECTS_VIA_OUTBOX = true;
    setupCreateAgencyReservationHappyPath();

    const result = await reservationService.createAgencyReservation(
      TRIP_ID,
      'Ana Pérez',
      'V123',
      null,
      [
        { seat_id: SEAT_ID, name: 'Ana', document: 'V1', phone: null },
        { seat_id: 'seat-2', name: 'Luis', document: 'V2', phone: null },
      ],
      AGENCY_ID,
      USER_ID,
    );

    expect(result.reservation.id).toBe(RES_ID);
    expect(result.qr_code).toBe('ABCDEF12');
    expect(mockRpc).toHaveBeenCalledWith(
      'create_agency_reservation',
      expect.objectContaining({
        p_trip_id: TRIP_ID,
        p_agency_id: AGENCY_ID,
      }),
    );
    expect(notificationService.createForAgency).not.toHaveBeenCalled();
  });
});

describe('createAgencyReservation — ERR_TRIP_DEPARTED', () => {
  it('maps ERR_TRIP_DEPARTED to ConflictError', async () => {
    queueFrom('trips', [readSingle({ id: TRIP_ID, capacity: 31 })]);
    queueFrom('trip_agencies', [readSingle({ id: 'alloc-1' })]);
    queueFrom('seats', [readCount(10), readCount(0)]);
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'ERR_TRIP_DEPARTED: Cannot create a reservation after departure time',
      },
    });

    await expect(
      reservationService.createAgencyReservation(
        TRIP_ID,
        'Ana Pérez',
        'V123',
        null,
        [{ seat_id: SEAT_ID, name: 'Ana', document: 'V1', phone: null }],
        AGENCY_ID,
        USER_ID,
      ),
    ).rejects.toMatchObject({
      name: 'ConflictError',
      statusCode: 409,
      message:
        'This trip has already departed. Reservations are no longer accepted.',
    });
  });
});
