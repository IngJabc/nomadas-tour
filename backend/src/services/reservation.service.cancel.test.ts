import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  TRIP_EFFECTS_VIA_OUTBOX: false,
  EMAIL_VIA_OUTBOX: false,
}));

const mockRpc = vi.hoisted(() => vi.fn());
const mockCreateForAgency = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(undefined)),
);

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
    LOCK_TTL_SECONDS: 600,
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
  },
}));

vi.mock('../config/database.js', () => ({
  get supabaseAdmin() {
    return {
      rpc: mockRpc,
      from: (table: string) => {
        if (table === 'reservations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        id: 'res-1',
                        trip_id: 'trip-1',
                        booker_name: 'Ana',
                        status: 'confirmed',
                        agency_id: 'agency-1',
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        if (table === 'trips') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { routes: { origin: 'A', destination: 'B' } },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'agencies') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { name: 'Agencia Central' },
                    error: null,
                  }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected from('${table}')`);
      },
    };
  },
}));

vi.mock('./notification.service.js', () => ({
  notificationService: {
    createForAgency: (...args: unknown[]) => mockCreateForAgency(...args),
  },
}));

vi.mock('./email.service.js', () => ({
  emailService: {},
}));

vi.mock('./boarding-attempts.service.js', () => ({
  hashBoardingCredential: vi.fn(),
  recordBoardingAttempt: vi.fn(),
}));

vi.mock('./occupancy-alert.service.js', () => ({
  listAgencyOccupancyAlerts: vi.fn(),
}));

vi.mock('../utils/qr.js', () => ({
  generateQRContent: vi.fn(),
  generateQRDataURL: vi.fn(),
}));

import { reservationService } from './reservation.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.TRIP_EFFECTS_VIA_OUTBOX = false;
});

describe('reservationService.cancelAgencyReservation (F5-001)', () => {
  it('cancels via cancel_agency_reservation RPC with actor + metadata', async () => {
    mockRpc.mockResolvedValue({
      data: { cancelled: true, reservation_id: 'res-1', freed_seats: 2 },
      error: null,
    });

    const result = await reservationService.cancelAgencyReservation(
      'res-1',
      'agency-1',
      'user-1',
      { source: 'api', ip: '1.2.3.4' },
    );

    expect(mockRpc).toHaveBeenCalledWith('cancel_agency_reservation', {
      p_reservation_id: 'res-1',
      p_actor_user_id: 'user-1',
      p_agency_id: 'agency-1',
      p_metadata: { source: 'api', ip: '1.2.3.4' },
    });
    expect(result).toEqual({
      cancelled: true,
      reservation_id: 'res-1',
      freed_seats: 2,
    });
    expect(mockCreateForAgency).toHaveBeenCalled();
    const notif = mockCreateForAgency.mock.calls[0]?.[0] as {
      type: string;
      body: string;
    };
    expect(notif.type).toBe('reservation_cancelled');
    expect(notif.body).toContain('Agencia Central');
    expect(notif.body).toContain('B');
    expect(notif.body).not.toMatch(/A → B/);
    expect(notif.body).not.toMatch(/La reserva de Ana fue cancelada/);
  });

  it('maps actor mismatch to ValidationError without notifying', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'ERR_ACTOR_AGENCY_MISMATCH: Actor must be agency belonging to p_agency_id',
      },
    });

    await expect(
      reservationService.cancelAgencyReservation('res-1', 'agency-1', 'user-x'),
    ).rejects.toThrow(/Actor must be agency/);

    expect(mockCreateForAgency).not.toHaveBeenCalled();
  });
});
