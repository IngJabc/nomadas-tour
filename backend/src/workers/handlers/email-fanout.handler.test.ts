import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../config/env.js', () => ({
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
    EMAIL_VIA_OUTBOX: false,
    TRIP_EFFECTS_VIA_OUTBOX: false,
    EMAIL_DELIVERY_MODE: 'normal',
    EMAIL_ALLOWED_RECIPIENTS: [],
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

vi.mock('../../config/database.js', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('../../services/notification-delivery.policy.js', () => ({
  notificationDeliveryPolicy: {
    shouldDeliver: vi.fn(async () => true),
    filterAgencyNotificationRows: vi.fn(async (rows: unknown[]) => rows),
  },
}));

vi.mock('../../services/email.service.js', () => ({
  emailService: {
    sendNewTripAssignedEmail: vi.fn(),
    sendTripPostponedEmail: vi.fn(),
    sendTripCancelledEmail: vi.fn(),
    sendReservationConfirmationEmail: vi.fn(),
  },
}));

vi.mock('../../services/reservation.service.js', () => ({
  reservationService: { getTicketData: vi.fn() },
}));

import type { OutboxEventRow } from '../../events/types.js';
import {
  TRIP_CANCELLED_V1_TYPE,
  TRIP_CANCELLED_V1_VERSION,
} from '../../events/trip-cancelled.v1.js';
import {
  TRIP_CREATED_V1_TYPE,
  TRIP_CREATED_V1_VERSION,
} from '../../events/trip-created.v1.js';
import {
  TRIP_POSTPONED_V1_TYPE,
  TRIP_POSTPONED_V1_VERSION,
} from '../../events/trip-postponed.v1.js';
import {
  createEmailFanoutHandler,
  type EmailFanoutDeps,
} from './email-fanout.handler.js';
import { buildDefaultHandlers, resolveHandler } from './index.js';

const EVENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TRIP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ROUTE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AGENCY_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const AGENCY_B = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function tripRow(
  eventType: string,
  eventVersion: number,
  payload: Record<string, unknown>,
): OutboxEventRow {
  return {
    id: EVENT_ID,
    event_type: eventType,
    event_version: eventVersion,
    aggregate_type: 'trip',
    aggregate_id: TRIP_ID,
    tenant_id: null,
    payload,
    status: 'processing',
    attempts: 1,
    available_at: '2026-08-10T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-10T12:00:00.000Z',
    updated_at: '2026-08-10T12:00:00.000Z',
  };
}

function makeDeps(overrides: Partial<EmailFanoutDeps> = {}): EmailFanoutDeps {
  return {
    isEffectsEnabled: () => true,
    getAgenciesWithEmail: vi.fn(async () => [
      { id: AGENCY_A, name: 'Agencia A', email: 'a@example.com' },
      { id: AGENCY_B, name: 'Agencia B', email: 'b@example.com' },
    ]),
    shouldDeliverEmail: vi.fn(async () => true),
    loadRoute: vi.fn(async () => ({
      origin: 'Caracas',
      destination: 'Mérida',
    })),
    formatDeparture: (iso) => `formatted:${iso}`,
    claimDelivery: vi.fn(async () => 'claimed' as const),
    markDeliverySent: vi.fn(async () => undefined),
    releaseDeliveryClaim: vi.fn(async () => undefined),
    sendNewTripAssignedEmail: vi.fn(async () => ({ status: 'sent' as const })),
    sendTripPostponedEmail: vi.fn(async () => ({ status: 'sent' as const })),
    sendTripCancelledEmail: vi.fn(async () => ({ status: 'sent' as const })),
    ...overrides,
  };
}

const createdPayload = {
  trip_id: TRIP_ID,
  route_id: ROUTE_ID,
  departure_time: '2026-08-15T12:00:00.000Z',
  vehicle_type: 'bus',
  capacity: 31,
  agency_ids: [AGENCY_A, AGENCY_B],
};

describe('WKR-007 C5 — EmailFanout', () => {
  it('flag=false skips without sending or claiming delivery', async () => {
    const deps = makeDeps({ isEffectsEnabled: () => false });
    const handler = createEmailFanoutHandler('trip.created', deps);

    await expect(
      handler(
        tripRow(TRIP_CREATED_V1_TYPE, TRIP_CREATED_V1_VERSION, createdPayload),
      ),
    ).resolves.toEqual({
      kind: 'completed',
      reason: 'skipped_effect_disabled',
    });
    expect(deps.claimDelivery).not.toHaveBeenCalled();
    expect(deps.sendNewTripAssignedEmail).not.toHaveBeenCalled();
  });

  it('trip.created sends one email per agency and marks sent', async () => {
    const deps = makeDeps();
    const handler = createEmailFanoutHandler('trip.created', deps);

    await expect(
      handler(
        tripRow(TRIP_CREATED_V1_TYPE, TRIP_CREATED_V1_VERSION, createdPayload),
      ),
    ).resolves.toEqual({ kind: 'completed', reason: 'sent' });

    expect(deps.claimDelivery).toHaveBeenCalledTimes(2);
    expect(deps.sendNewTripAssignedEmail).toHaveBeenCalledTimes(2);
    expect(deps.sendNewTripAssignedEmail).toHaveBeenCalledWith(
      'a@example.com',
      'Agencia A',
      'Caracas',
      'Mérida',
      'formatted:2026-08-15T12:00:00.000Z',
      'bus',
      31,
      TRIP_ID,
      AGENCY_A,
    );
    expect(deps.markDeliverySent).toHaveBeenCalledTimes(2);
    expect(deps.releaseDeliveryClaim).not.toHaveBeenCalled();
  });

  it('trip.postponed and trip.cancelled use the correct templates', async () => {
    const deps = makeDeps({
      getAgenciesWithEmail: vi.fn(async () => [
        { id: AGENCY_A, name: 'Agencia A', email: 'a@example.com' },
      ]),
    });
    const postponed = createEmailFanoutHandler('trip.postponed', deps);
    const cancelled = createEmailFanoutHandler('trip.cancelled', deps);

    await postponed(
      tripRow(TRIP_POSTPONED_V1_TYPE, TRIP_POSTPONED_V1_VERSION, {
        trip_id: TRIP_ID,
        route_id: ROUTE_ID,
        previous_departure_time: '2026-08-14T12:00:00.000Z',
        departure_time: '2026-08-16T12:00:00.000Z',
        agency_ids: [AGENCY_A],
      }),
    );
    await cancelled(
      tripRow(TRIP_CANCELLED_V1_TYPE, TRIP_CANCELLED_V1_VERSION, {
        trip_id: TRIP_ID,
        route_id: ROUTE_ID,
        departure_time: '2026-08-15T12:00:00.000Z',
        status: 'cancelled',
        agency_ids: [AGENCY_A],
      }),
    );

    expect(deps.sendTripPostponedEmail).toHaveBeenCalledOnce();
    expect(deps.sendTripCancelledEmail).toHaveBeenCalledOnce();
    expect(deps.sendNewTripAssignedEmail).not.toHaveBeenCalled();
  });

  it('idempotent when delivery already logged (no second send)', async () => {
    const deps = makeDeps({
      claimDelivery: vi.fn(async () => 'already_logged' as const),
    });
    const handler = createEmailFanoutHandler('trip.created', deps);

    await expect(
      handler(
        tripRow(TRIP_CREATED_V1_TYPE, TRIP_CREATED_V1_VERSION, createdPayload),
      ),
    ).resolves.toEqual({ kind: 'completed', reason: 'already_sent' });
    expect(deps.sendNewTripAssignedEmail).not.toHaveBeenCalled();
    expect(deps.markDeliverySent).not.toHaveBeenCalled();
  });

  it('Resend restricted skip is honest: release claim, no sent, no crash', async () => {
    const deps = makeDeps({
      getAgenciesWithEmail: vi.fn(async () => [
        { id: AGENCY_A, name: 'Agencia A', email: 'blocked@example.com' },
      ]),
      sendNewTripAssignedEmail: vi.fn(async () => ({
        status: 'skipped' as const,
        reason: 'restricted' as const,
      })),
    });
    const handler = createEmailFanoutHandler('trip.created', deps);

    await expect(
      handler(
        tripRow(TRIP_CREATED_V1_TYPE, TRIP_CREATED_V1_VERSION, {
          ...createdPayload,
          agency_ids: [AGENCY_A],
        }),
      ),
    ).resolves.toEqual({
      kind: 'completed',
      reason: 'skipped_restricted',
    });
    expect(deps.releaseDeliveryClaim).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      recipientId: AGENCY_A,
      emailType: 'trip_created',
    });
    expect(deps.markDeliverySent).not.toHaveBeenCalled();
  });

  it('send failure releases claim and returns retryable failure', async () => {
    const deps = makeDeps({
      getAgenciesWithEmail: vi.fn(async () => [
        { id: AGENCY_A, name: 'Agencia A', email: 'a@example.com' },
      ]),
      sendNewTripAssignedEmail: vi.fn(async () => {
        throw new Error('Failed to send new trip assigned email');
      }),
    });
    const handler = createEmailFanoutHandler('trip.created', deps);

    await expect(
      handler(
        tripRow(TRIP_CREATED_V1_TYPE, TRIP_CREATED_V1_VERSION, {
          ...createdPayload,
          agency_ids: [AGENCY_A],
        }),
      ),
    ).resolves.toEqual({
      kind: 'failed',
      permanent: false,
      reason: 'Failed to send new trip assigned email',
    });
    expect(deps.releaseDeliveryClaim).toHaveBeenCalledOnce();
    expect(deps.markDeliverySent).not.toHaveBeenCalled();
  });

  it('invalid payload is permanent failure', async () => {
    const deps = makeDeps();
    const handler = createEmailFanoutHandler('trip.created', deps);

    await expect(
      handler(
        tripRow(TRIP_CREATED_V1_TYPE, TRIP_CREATED_V1_VERSION, {
          trip_id: TRIP_ID,
        }),
      ),
    ).resolves.toMatchObject({ kind: 'failed', permanent: true });
    expect(deps.sendNewTripAssignedEmail).not.toHaveBeenCalled();
  });

  it('DB claim errors are retryable and do not mark sent', async () => {
    const deps = makeDeps({
      getAgenciesWithEmail: vi.fn(async () => [
        { id: AGENCY_A, name: 'Agencia A', email: 'a@example.com' },
      ]),
      claimDelivery: vi.fn(async () => {
        throw new Error('claimDelivery: db down');
      }),
    });
    const handler = createEmailFanoutHandler('trip.created', deps);

    await expect(
      handler(
        tripRow(TRIP_CREATED_V1_TYPE, TRIP_CREATED_V1_VERSION, {
          ...createdPayload,
          agency_ids: [AGENCY_A],
        }),
      ),
    ).resolves.toEqual({
      kind: 'failed',
      permanent: false,
      reason: 'claimDelivery: db down',
    });
    expect(deps.sendNewTripAssignedEmail).not.toHaveBeenCalled();
  });
});

describe('WKR-007 C5 — registry wiring', () => {
  it('registers EmailFanout for the three C5 events and keeps C4', () => {
    const handlers = buildDefaultHandlers();

    for (const key of [
      `${TRIP_CREATED_V1_TYPE}:1`,
      `${TRIP_POSTPONED_V1_TYPE}:1`,
      `${TRIP_CANCELLED_V1_TYPE}:1`,
      'trip.completed:1',
      'trip.auto_completed:1',
      'trip.archived:1',
      'reservation.created:1',
    ]) {
      expect(handlers.has(key)).toBe(true);
      expect(resolveHandler(handlers, key.split(':')[0], 1)).toBeTypeOf(
        'function',
      );
    }

    expect(handlers.has('trip.updated:1')).toBe(false);

    const indexSource = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts'),
      'utf8',
    );
    expect(indexSource).toContain('email-fanout.handler');
    expect(indexSource).toContain('createEmailFanoutHandler');
    expect(indexSource).toContain('notification-fanout.handler');
    expect(indexSource).not.toContain('TRIP_UPDATED_V1_TYPE');
  });
});
