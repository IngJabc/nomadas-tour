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
    OUTBOX_RETENTION_VIA_WORKER: false,
    OUTBOX_RETENTION_POLL_MS: 86_400_000,
    OUTBOX_RETENTION_BATCH: 1000,
    OUTBOX_RETENTION_DAYS: 30,
    AGENCY_DIGEST_VIA_WORKER: true,
    AGENCY_DIGEST_POLL_MS: 3_600_000,
    AGENCY_DIGEST_BATCH: 50,
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

vi.mock('../../services/email.service.js', () => ({
  emailService: {
    sendAgencyDigestEmail: vi.fn(),
  },
}));

vi.mock('../../services/notification-delivery.policy.js', () => ({
  notificationDeliveryPolicy: {
    shouldDeliver: vi.fn(async () => true),
  },
}));

vi.mock('../../services/agency-digest.service.js', () => ({
  loadAgencyDigestAggregates: vi.fn(),
}));

import type { OutboxEventRow } from '../../events/types.js';
import {
  AGENCY_DIGEST_DUE_V1_AGGREGATE,
  AGENCY_DIGEST_DUE_V1_TYPE,
  AGENCY_DIGEST_DUE_V1_VERSION,
} from '../../events/agency-digest-due.v1.js';
import type { AgencyDigestAggregates } from '../../services/agency-digest.service.js';
import {
  createAgencyDigestFanoutHandler,
  type AgencyDigestFanoutDeps,
} from './agency-digest-fanout.handler.js';

const AGENCY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AGENCY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const EVENT_ID = '33333333-3333-3333-3333-333333333333';

function makeRow(
  overrides: Partial<OutboxEventRow> = {},
): OutboxEventRow {
  return {
    id: EVENT_ID,
    event_type: AGENCY_DIGEST_DUE_V1_TYPE,
    event_version: AGENCY_DIGEST_DUE_V1_VERSION,
    aggregate_type: AGENCY_DIGEST_DUE_V1_AGGREGATE,
    aggregate_id: AGENCY_A,
    tenant_id: AGENCY_A,
    payload: { agency_id: AGENCY_A, digest_date: '2026-08-12' },
    status: 'pending',
    attempts: 0,
    available_at: '2026-08-12T11:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-12T11:00:00.000Z',
    updated_at: '2026-08-12T11:00:00.000Z',
    ...overrides,
  };
}

function makeAggregates(
  agencyId = AGENCY_A,
): AgencyDigestAggregates {
  return {
    agency_id: agencyId,
    agency_name: 'Agencia Central',
    agency_email: 'ops@agency.test',
    digest_date: '2026-08-12',
    active_trips: 2,
    today_reservations: 1,
    pending_boarding_passengers: 3,
    upcoming_trips: [
      {
        trip_id: 'trip-1',
        route_label: 'Caracas → Mérida',
        departure_time: '2026-08-13T12:00:00.000Z',
        departure_formatted: '13 ago 2026, 08:00 AM',
        reservation_count: 4,
        capacity: 31,
        available_seats: 10,
        occupancy_pct: 68,
      },
    ],
    dashboard_url: 'http://localhost:3000/agency',
  };
}

function makeDeps(
  overrides: Partial<AgencyDigestFanoutDeps> = {},
): AgencyDigestFanoutDeps {
  return {
    isEffectsEnabled: () => true,
    shouldDeliverAgencyEmail: vi.fn(async () => true),
    loadAggregates: vi.fn(async () => makeAggregates()),
    claimDelivery: vi.fn(async () => 'claimed'),
    markDeliverySent: vi.fn(async () => undefined),
    releaseDeliveryClaim: vi.fn(async () => undefined),
    sendAgencyDigestEmail: vi.fn(async () => ({ status: 'sent' as const })),
    ...overrides,
  };
}

describe('F4-001 — agency digest fanout handler', () => {
  it('skips when flag disabled', async () => {
    const deps = makeDeps({ isEffectsEnabled: () => false });
    const handler = createAgencyDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({
      kind: 'completed',
      reason: 'skipped_effect_disabled',
    });
    expect(deps.sendAgencyDigestEmail).not.toHaveBeenCalled();
  });

  it('skips when preference email disabled', async () => {
    const deps = makeDeps({
      shouldDeliverAgencyEmail: vi.fn(async () => false),
    });
    const handler = createAgencyDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({ kind: 'completed', reason: 'skipped_disabled' });
    expect(deps.sendAgencyDigestEmail).not.toHaveBeenCalled();
  });

  it('skips when agency has no email / inactive', async () => {
    const deps = makeDeps({
      loadAggregates: vi.fn(async () => null),
    });
    const handler = createAgencyDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({ kind: 'completed', reason: 'skipped_no_email' });
  });

  it('claims, sends, and marks sent', async () => {
    const deps = makeDeps();
    const handler = createAgencyDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({ kind: 'completed', reason: 'sent' });
    expect(deps.claimDelivery).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      recipientId: AGENCY_A,
      emailType: 'agency_digest',
    });
    expect(deps.sendAgencyDigestEmail).toHaveBeenCalledWith(
      'ops@agency.test',
      expect.objectContaining({ agency_id: AGENCY_A }),
    );
    expect(deps.markDeliverySent).toHaveBeenCalled();
  });

  it('does not resend when already_logged (retry idempotency)', async () => {
    const deps = makeDeps({
      claimDelivery: vi.fn(async () => 'already_logged'),
    });
    const handler = createAgencyDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({ kind: 'completed', reason: 'already_sent' });
    expect(deps.sendAgencyDigestEmail).not.toHaveBeenCalled();
  });

  it('releases claim and requeues on send failure', async () => {
    const deps = makeDeps({
      sendAgencyDigestEmail: vi.fn(async () => {
        throw new Error('resend down');
      }),
    });
    const handler = createAgencyDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({
      kind: 'failed',
      permanent: false,
      reason: 'resend down',
    });
    expect(deps.releaseDeliveryClaim).toHaveBeenCalled();
  });

  it('fails permanently on tenancy mismatch in aggregates', async () => {
    const deps = makeDeps({
      loadAggregates: vi.fn(async () => makeAggregates(AGENCY_B)),
    });
    const handler = createAgencyDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.permanent).toBe(true);
      expect(outcome.reason).toMatch(/tenancy_mismatch/);
    }
    expect(deps.sendAgencyDigestEmail).not.toHaveBeenCalled();
  });

  it('loads aggregates scoped to event agency_id and digest_date', async () => {
    const loadAggregates = vi.fn(async () => makeAggregates());
    const deps = makeDeps({ loadAggregates });
    const handler = createAgencyDigestFanoutHandler(deps);
    await handler(makeRow());
    expect(loadAggregates).toHaveBeenCalledWith(AGENCY_A, '2026-08-12');
  });
});
