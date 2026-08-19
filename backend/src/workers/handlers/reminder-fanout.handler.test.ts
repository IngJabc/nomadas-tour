import { describe, expect, it, vi } from 'vitest';

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
    LOCK_TTL_SECONDS: 600,
    EMAIL_VIA_OUTBOX: false,
    TRIP_EFFECTS_VIA_OUTBOX: false,
    TRIP_REMINDER_VIA_OUTBOX: false,
    REMINDER_SCHEDULE_POLL_MS: 3_600_000,
    REMINDER_SCHEDULE_BATCH: 50,
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
    sendTripReminderEmail: vi.fn(),
  },
}));

import type { OutboxEventRow } from '../../events/types.js';
import {
  TRIP_REMINDER_DUE_V1_TYPE,
  TRIP_REMINDER_DUE_V1_VERSION,
} from '../../events/trip-reminder-due.v1.js';
import {
  createReminderFanoutHandler,
  reminderEmailTypeForWindow,
  type ReminderFanoutDeps,
} from './reminder-fanout.handler.js';
import { buildDefaultHandlers, resolveHandler } from './index.js';
import {
  createDefaultNotificationFanoutDeps,
  createNotificationFanoutHandler,
} from './notification-fanout.handler.js';
import { composeHandlers } from './compose.js';

const EVENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TRIP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ROUTE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AGENCY_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const RES_A = '11111111-1111-1111-1111-111111111111';
const RES_B = '22222222-2222-2222-2222-222222222222';

function reminderRow(
  payload: Record<string, unknown>,
): OutboxEventRow {
  return {
    id: EVENT_ID,
    event_type: TRIP_REMINDER_DUE_V1_TYPE,
    event_version: TRIP_REMINDER_DUE_V1_VERSION,
    aggregate_type: 'trip',
    aggregate_id: TRIP_ID,
    tenant_id: null,
    payload,
    status: 'processing',
    attempts: 1,
    available_at: '2026-08-11T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-11T12:00:00.000Z',
    updated_at: '2026-08-11T12:00:00.000Z',
  };
}

function makeDeps(overrides: Partial<ReminderFanoutDeps> = {}): ReminderFanoutDeps {
  return {
    isEffectsEnabled: () => true,
    getAgenciesWithEmail: vi.fn(async () => [
      { id: AGENCY_A, name: 'Agencia A', email: 'agency@example.com' },
    ]),
    loadBookersWithEmail: vi.fn(async () => [
      { id: RES_A, name: 'Ana', email: 'ana@example.com' },
    ]),
    shouldDeliverAgencyEmail: vi.fn(async () => true),
    loadRoute: vi.fn(async () => ({
      origin: 'Caracas',
      destination: 'Mérida',
    })),
    formatDeparture: (iso) => `formatted:${iso}`,
    claimDelivery: vi.fn(async () => 'claimed' as const),
    markDeliverySent: vi.fn(async () => undefined),
    releaseDeliveryClaim: vi.fn(async () => undefined),
    sendTripReminderEmail: vi.fn(async () => ({ status: 'sent' as const })),
    ...overrides,
  };
}

const t48Payload = {
  trip_id: TRIP_ID,
  route_id: ROUTE_ID,
  departure_time: '2026-08-15T20:00:00.000Z',
  window: 't48' as const,
  agency_ids: [AGENCY_A],
};

const t24Payload = { ...t48Payload, window: 't24' as const };

describe('WKR-008 — ReminderFanout', () => {
  it('maps window to ledger email_type', () => {
    expect(reminderEmailTypeForWindow('t48')).toBe('trip_reminder_t48');
    expect(reminderEmailTypeForWindow('t24')).toBe('trip_reminder_t24');
  });

  it('flag=false skips without claiming or sending', async () => {
    const deps = makeDeps({ isEffectsEnabled: () => false });
    const handler = createReminderFanoutHandler(deps);
    await expect(handler(reminderRow(t48Payload))).resolves.toEqual({
      kind: 'completed',
      reason: 'skipped_effect_disabled',
    });
    expect(deps.claimDelivery).not.toHaveBeenCalled();
    expect(deps.sendTripReminderEmail).not.toHaveBeenCalled();
  });

  it('sends booker + agency emails for t48 with claim→send→mark', async () => {
    const deps = makeDeps();
    const handler = createReminderFanoutHandler(deps);

    await expect(handler(reminderRow(t48Payload))).resolves.toEqual({
      kind: 'completed',
      reason: 'sent',
    });

    expect(deps.claimDelivery).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      recipientId: RES_A,
      emailType: 'trip_reminder_t48',
    });
    expect(deps.claimDelivery).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      recipientId: AGENCY_A,
      emailType: 'trip_reminder_t48',
    });
    expect(deps.sendTripReminderEmail).toHaveBeenCalledTimes(2);
    expect(deps.sendTripReminderEmail).toHaveBeenCalledWith(
      'ana@example.com',
      'Ana',
      'Caracas',
      'Mérida',
      'formatted:2026-08-15T20:00:00.000Z',
      't48',
      TRIP_ID,
    );
    expect(deps.markDeliverySent).toHaveBeenCalledTimes(2);
  });

  it('uses trip_reminder_t24 for t24 window', async () => {
    const deps = makeDeps();
    const handler = createReminderFanoutHandler(deps);
    await handler(reminderRow(t24Payload));
    expect(deps.claimDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ emailType: 'trip_reminder_t24' }),
    );
    expect(deps.sendTripReminderEmail).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      't24',
      TRIP_ID,
    );
  });

  it('skips bookers without contact_email (loader filters them out)', async () => {
    const deps = makeDeps({
      loadBookersWithEmail: vi.fn(async () => []),
    });
    const handler = createReminderFanoutHandler(deps);
    await handler(reminderRow(t48Payload));
    expect(deps.claimDelivery).toHaveBeenCalledTimes(1);
    expect(deps.claimDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: AGENCY_A }),
    );
  });

  it('respects agency email preferences', async () => {
    const deps = makeDeps({
      shouldDeliverAgencyEmail: vi.fn(async () => false),
      loadBookersWithEmail: vi.fn(async () => []),
    });
    const handler = createReminderFanoutHandler(deps);
    await expect(handler(reminderRow(t48Payload))).resolves.toEqual({
      kind: 'completed',
      reason: 'skipped_no_email',
    });
    expect(deps.claimDelivery).not.toHaveBeenCalled();
  });

  it('ledger idempotency: already_logged skips send', async () => {
    const deps = makeDeps({
      claimDelivery: vi.fn(async () => 'already_logged' as const),
    });
    const handler = createReminderFanoutHandler(deps);
    await expect(handler(reminderRow(t48Payload))).resolves.toEqual({
      kind: 'completed',
      reason: 'already_sent',
    });
    expect(deps.sendTripReminderEmail).not.toHaveBeenCalled();
    expect(deps.markDeliverySent).not.toHaveBeenCalled();
  });

  it('releases claim on send error', async () => {
    const deps = makeDeps({
      loadBookersWithEmail: vi.fn(async () => [
        { id: RES_B, name: 'Bob', email: 'bob@example.com' },
      ]),
      getAgenciesWithEmail: vi.fn(async () => []),
      sendTripReminderEmail: vi.fn(async () => {
        throw new Error('resend down');
      }),
    });
    const handler = createReminderFanoutHandler(deps);
    await expect(handler(reminderRow(t48Payload))).resolves.toEqual({
      kind: 'failed',
      permanent: false,
      reason: 'resend down',
    });
    expect(deps.releaseDeliveryClaim).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      recipientId: RES_B,
      emailType: 'trip_reminder_t48',
    });
  });

  it('releases claim on skipped_restricted and does not mark sent', async () => {
    const deps = makeDeps({
      getAgenciesWithEmail: vi.fn(async () => []),
      sendTripReminderEmail: vi.fn(async () => ({
        status: 'skipped' as const,
        reason: 'restricted' as const,
      })),
    });
    const handler = createReminderFanoutHandler(deps);
    await expect(handler(reminderRow(t48Payload))).resolves.toEqual({
      kind: 'completed',
      reason: 'skipped_restricted',
    });
    expect(deps.releaseDeliveryClaim).toHaveBeenCalled();
    expect(deps.markDeliverySent).not.toHaveBeenCalled();
  });

  it('in-app notification fanout uses trip_reminder + reminder flag', async () => {
    const insertNotificationRows = vi.fn(async () => ({ error: null }));
    const notif = createNotificationFanoutHandler('trip_reminder', {
      ...createDefaultNotificationFanoutDeps(),
      isEffectsEnabled: () => true,
      loadRoute: async () => ({ origin: 'Caracas', destination: 'Mérida' }),
      findExistingBySourceEventId: async () => [],
      insertNotificationRows,
      filterAgencyNotificationRows: async (rows) => rows,
      formatDeparture: (iso) => `fmt:${iso}`,
      loadReservationContext: async () => null,
    });

    await expect(notif(reminderRow(t48Payload))).resolves.toEqual({
      kind: 'completed',
      reason: 'delivered',
    });

    expect(insertNotificationRows).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'trip_reminder',
        title: 'Recordatorio de viaje',
        body: expect.stringContaining('dos días'),
        agency_id: AGENCY_A,
        source_event_id: EVENT_ID,
        metadata: expect.objectContaining({ window: 't48' }),
      }),
    ]);
  });

  it('composed handlers are registered for trip.reminder_due:1', () => {
    const handlers = buildDefaultHandlers();
    const handler = resolveHandler(
      handlers,
      TRIP_REMINDER_DUE_V1_TYPE,
      TRIP_REMINDER_DUE_V1_VERSION,
    );
    expect(handler).toBeTypeOf('function');
  });

  it('compose runs reminder email + in-app notification', async () => {
    const deps = makeDeps({
      getAgenciesWithEmail: vi.fn(async () => []),
      loadBookersWithEmail: vi.fn(async () => [
        { id: RES_A, name: 'Ana', email: 'ana@example.com' },
      ]),
    });
    const insertNotificationRows = vi.fn(async () => ({ error: null }));
    const composed = composeHandlers(
      createReminderFanoutHandler(deps),
      createNotificationFanoutHandler('trip_reminder', {
        ...createDefaultNotificationFanoutDeps(),
        isEffectsEnabled: () => true,
        loadRoute: async () => ({ origin: 'Caracas', destination: 'Mérida' }),
        findExistingBySourceEventId: async () => [],
        insertNotificationRows,
        filterAgencyNotificationRows: async (rows) => rows,
        formatDeparture: (iso) => iso,
        loadReservationContext: async () => null,
      }),
    );

    await expect(composed(reminderRow(t48Payload))).resolves.toMatchObject({
      kind: 'completed',
    });
    expect(deps.sendTripReminderEmail).toHaveBeenCalled();
    expect(insertNotificationRows).toHaveBeenCalled();
  });
});
