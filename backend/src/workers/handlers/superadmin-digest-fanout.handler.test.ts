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
    LOCK_TTL_SECONDS: 300,
    EMAIL_VIA_OUTBOX: false,
    TRIP_EFFECTS_VIA_OUTBOX: false,
    TRIP_REMINDER_VIA_OUTBOX: false,
    REMINDER_SCHEDULE_POLL_MS: 3_600_000,
    REMINDER_SCHEDULE_BATCH: 50,
    OUTBOX_RETENTION_VIA_WORKER: false,
    OUTBOX_RETENTION_POLL_MS: 86_400_000,
    OUTBOX_RETENTION_BATCH: 1000,
    OUTBOX_RETENTION_DAYS: 30,
    AGENCY_DIGEST_VIA_WORKER: false,
    AGENCY_DIGEST_POLL_MS: 3_600_000,
    AGENCY_DIGEST_BATCH: 50,
    SUPERADMIN_DIGEST_VIA_WORKER: true,
    SUPERADMIN_DIGEST_POLL_MS: 3_600_000,
    SUPERADMIN_DIGEST_BATCH: 50,
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
    sendSuperadminDigestEmail: vi.fn(),
  },
}));

vi.mock('../../services/superadmin-digest.service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/superadmin-digest.service.js')
  >('../../services/superadmin-digest.service.js');
  return {
    ...actual,
    loadSuperadminDigestAggregates: vi.fn(),
    loadEligibleSuperadmins: vi.fn(),
  };
});

import type { OutboxEventRow } from '../../events/types.js';
import {
  SUPERADMIN_DIGEST_DUE_V1_AGGREGATE,
  SUPERADMIN_DIGEST_DUE_V1_TYPE,
  SUPERADMIN_DIGEST_DUE_V1_VERSION,
} from '../../events/superadmin-digest-due.v1.js';
import type { SuperadminDigestAggregates } from '../../services/superadmin-digest.service.js';
import {
  createSuperadminDigestFanoutHandler,
  type SuperadminDigestFanoutDeps,
} from './superadmin-digest-fanout.handler.js';

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const EVENT_ID = '33333333-3333-3333-3333-333333333333';
const AGGREGATE_ID = '44444444-4444-4444-4444-444444444444';

function makeRow(
  overrides: Partial<OutboxEventRow> = {},
): OutboxEventRow {
  return {
    id: EVENT_ID,
    event_type: SUPERADMIN_DIGEST_DUE_V1_TYPE,
    event_version: SUPERADMIN_DIGEST_DUE_V1_VERSION,
    aggregate_type: SUPERADMIN_DIGEST_DUE_V1_AGGREGATE,
    aggregate_id: AGGREGATE_ID,
    tenant_id: null,
    payload: { digest_date: '2026-08-13' },
    status: 'pending',
    attempts: 0,
    available_at: '2026-08-13T11:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-13T11:00:00.000Z',
    updated_at: '2026-08-13T11:00:00.000Z',
    ...overrides,
  };
}

function makeAggregates(
  overrides: Partial<SuperadminDigestAggregates> = {},
): SuperadminDigestAggregates {
  return {
    digest_date: '2026-08-13',
    total_agencies: 4,
    active_agencies: 3,
    active_trips: 2,
    today_reservations: 1,
    pending_boarding_passengers: 3,
    upcoming_trips: [
      {
        trip_id: 'trip-1',
        route_label: 'Caracas → Mérida',
        departure_time: '2026-08-13T16:00:00.000Z',
        departure_formatted: '13 ago 2026',
        reservation_count: 4,
        capacity: 31,
        available_seats: 10,
        occupancy_pct: 68,
      },
    ],
    occupancy_by_trip: [
      {
        trip_id: 'trip-1',
        label: 'Caracas → Mérida',
        departure: '2026-08-13T16:00:00.000Z',
        total: 31,
        reserved: 21,
        occupancy_pct: 68,
      },
    ],
    dashboard_url: 'http://localhost:3000/admin',
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<SuperadminDigestFanoutDeps> = {},
): SuperadminDigestFanoutDeps {
  return {
    isEffectsEnabled: () => true,
    batch: 50,
    loadAggregates: vi.fn(async () => makeAggregates()),
    loadRecipients: vi.fn(async () => [
      { user_id: USER_A, email: 'one@nomadas.tour' },
    ]),
    claimDelivery: vi.fn(async () => 'claimed'),
    markDeliverySent: vi.fn(async () => undefined),
    releaseDeliveryClaim: vi.fn(async () => undefined),
    sendSuperadminDigestEmail: vi.fn(async () => ({ status: 'sent' as const })),
    ...overrides,
  };
}

describe('F4-002 — superadmin digest fanout handler', () => {
  it('skips when flag disabled', async () => {
    const deps = makeDeps({ isEffectsEnabled: () => false });
    const handler = createSuperadminDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({
      kind: 'completed',
      reason: 'skipped_effect_disabled',
    });
    expect(deps.sendSuperadminDigestEmail).not.toHaveBeenCalled();
  });

  it('returns skipped_empty without claiming or sending', async () => {
    const deps = makeDeps({
      loadAggregates: vi.fn(async () =>
        makeAggregates({
          active_trips: 0,
          today_reservations: 0,
          pending_boarding_passengers: 0,
          upcoming_trips: [],
        }),
      ),
    });
    const handler = createSuperadminDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({ kind: 'completed', reason: 'skipped_empty' });
    expect(deps.loadRecipients).not.toHaveBeenCalled();
    expect(deps.claimDelivery).not.toHaveBeenCalled();
    expect(deps.sendSuperadminDigestEmail).not.toHaveBeenCalled();
  });

  it('skips when no eligible recipients after prefs', async () => {
    const deps = makeDeps({
      loadRecipients: vi.fn(async () => []),
    });
    const handler = createSuperadminDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({ kind: 'completed', reason: 'skipped_no_email' });
    expect(deps.sendSuperadminDigestEmail).not.toHaveBeenCalled();
  });

  it('sends independently to multiple superadmins with per-user ledger', async () => {
    const deps = makeDeps({
      loadRecipients: vi.fn(async () => [
        { user_id: USER_A, email: 'one@nomadas.tour' },
        { user_id: USER_B, email: 'two@nomadas.tour' },
      ]),
    });
    const handler = createSuperadminDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({ kind: 'completed', reason: 'sent' });
    expect(deps.claimDelivery).toHaveBeenCalledTimes(2);
    expect(deps.claimDelivery).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      recipientId: USER_A,
      emailType: 'superadmin_digest',
    });
    expect(deps.claimDelivery).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      recipientId: USER_B,
      emailType: 'superadmin_digest',
    });
    expect(deps.sendSuperadminDigestEmail).toHaveBeenCalledTimes(2);
    expect(deps.markDeliverySent).toHaveBeenCalledTimes(2);
  });

  it('does not resend users already logged on retry', async () => {
    const claimDelivery = vi.fn(async ({ recipientId }: { recipientId: string }) =>
      recipientId === USER_A ? 'already_logged' : 'claimed',
    );
    const deps = makeDeps({
      loadRecipients: vi.fn(async () => [
        { user_id: USER_A, email: 'one@nomadas.tour' },
        { user_id: USER_B, email: 'two@nomadas.tour' },
      ]),
      claimDelivery,
    });
    const handler = createSuperadminDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({ kind: 'completed', reason: 'sent' });
    expect(deps.sendSuperadminDigestEmail).toHaveBeenCalledTimes(1);
    expect(deps.sendSuperadminDigestEmail).toHaveBeenCalledWith(
      'two@nomadas.tour',
      expect.any(Object),
    );
  });

  it('releases claim and retries on partial send failure', async () => {
    const deps = makeDeps({
      loadRecipients: vi.fn(async () => [
        { user_id: USER_A, email: 'one@nomadas.tour' },
        { user_id: USER_B, email: 'two@nomadas.tour' },
      ]),
      sendSuperadminDigestEmail: vi.fn(async (to: string) => {
        if (to.startsWith('two')) throw new Error('resend down');
        return { status: 'sent' as const };
      }),
    });
    const handler = createSuperadminDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({
      kind: 'failed',
      permanent: false,
      reason: 'resend down',
    });
    expect(deps.markDeliverySent).toHaveBeenCalledTimes(1);
    expect(deps.releaseDeliveryClaim).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      recipientId: USER_B,
      emailType: 'superadmin_digest',
    });
  });

  it('keeps <=50 recipients completing in one pass', async () => {
    const recipients = Array.from({ length: 50 }, (_, i) => ({
      user_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      email: `u${i}@nomadas.tour`,
    }));
    const deps = makeDeps({
      batch: 50,
      loadRecipients: vi.fn(async () => recipients),
    });
    const handler = createSuperadminDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({ kind: 'completed', reason: 'sent' });
    expect(deps.sendSuperadminDigestEmail).toHaveBeenCalledTimes(50);
    expect(deps.claimDelivery).toHaveBeenCalledTimes(50);
  });

  it('reaches recipients beyond BATCH on retry without resending the first page', async () => {
    const recipients = Array.from({ length: 51 }, (_, i) => ({
      user_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      email: `u${i}@nomadas.tour`,
    }));
    const sent = new Set<string>();
    const claimDelivery = vi.fn(
      async ({ recipientId }: { recipientId: string }) =>
        sent.has(recipientId) ? 'already_logged' : 'claimed',
    );
    const markDeliverySent = vi.fn(
      async ({ recipientId }: { recipientId: string }) => {
        sent.add(recipientId);
      },
    );
    const sendSuperadminDigestEmail = vi.fn(async () => ({
      status: 'sent' as const,
    }));
    const deps = makeDeps({
      batch: 50,
      loadRecipients: vi.fn(async () => recipients),
      claimDelivery,
      markDeliverySent,
      sendSuperadminDigestEmail,
    });
    const handler = createSuperadminDigestFanoutHandler(deps);

    const first = await handler(makeRow());
    expect(first).toEqual({
      kind: 'failed',
      permanent: false,
      reason: 'recipient_batch_remaining',
    });
    expect(sendSuperadminDigestEmail).toHaveBeenCalledTimes(50);
    expect(sendSuperadminDigestEmail.mock.calls.map((c) => c[0])).toEqual(
      recipients.slice(0, 50).map((r) => r.email),
    );

    const second = await handler(makeRow());
    expect(second).toEqual({ kind: 'completed', reason: 'sent' });
    expect(sendSuperadminDigestEmail).toHaveBeenCalledTimes(51);
    expect(sendSuperadminDigestEmail.mock.calls[50]?.[0]).toBe(
      recipients[50].email,
    );
    expect(sent.size).toBe(51);
  });

  it('releases claim and does not mark sent on restricted mode', async () => {
    const deps = makeDeps({
      sendSuperadminDigestEmail: vi.fn(async () => ({
        status: 'skipped' as const,
        reason: 'restricted' as const,
      })),
    });
    const handler = createSuperadminDigestFanoutHandler(deps);
    const outcome = await handler(makeRow());
    expect(outcome).toEqual({
      kind: 'completed',
      reason: 'skipped_restricted',
    });
    expect(deps.markDeliverySent).not.toHaveBeenCalled();
    expect(deps.releaseDeliveryClaim).toHaveBeenCalled();
  });
});
