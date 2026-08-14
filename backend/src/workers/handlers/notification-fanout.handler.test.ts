import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
    OCCUPANCY_ALERT_VIA_WORKER: true,
    OCCUPANCY_URGENCY_VIA_WORKER: true,
  },
}));

vi.mock('../../config/database.js', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock('../../services/notification-delivery.policy.js', () => ({
  notificationDeliveryPolicy: {
    filterAgencyNotificationRows: vi.fn(async (rows: unknown[]) => rows),
    shouldDeliver: vi.fn(async () => true),
  },
}));

vi.mock('../../services/email.service.js', () => ({
  emailService: {
    sendReservationConfirmationEmail: vi.fn(),
    sendNewTripAssignedEmail: vi.fn(),
    sendTripPostponedEmail: vi.fn(),
    sendTripCancelledEmail: vi.fn(),
  },
}));

vi.mock('../../services/reservation.service.js', () => ({
  reservationService: {
    getTicketData: vi.fn(),
  },
}));

import type { OutboxEventRow } from '../../events/types.js';
import {
  RESERVATION_CREATED_V1_TYPE,
  RESERVATION_CREATED_V1_VERSION,
} from '../../events/reservation-created.v1.js';
import {
  TRIP_ARCHIVED_V1_TYPE,
  TRIP_ARCHIVED_V1_VERSION,
} from '../../events/trip-archived.v1.js';
import {
  TRIP_AUTO_COMPLETED_V1_TYPE,
  TRIP_AUTO_COMPLETED_V1_VERSION,
} from '../../events/trip-auto-completed.v1.js';
import {
  TRIP_CANCELLED_V1_TYPE,
  TRIP_CANCELLED_V1_VERSION,
} from '../../events/trip-cancelled.v1.js';
import {
  TRIP_COMPLETED_V1_TYPE,
  TRIP_COMPLETED_V1_VERSION,
} from '../../events/trip-completed.v1.js';
import {
  TRIP_CREATED_V1_TYPE,
  TRIP_CREATED_V1_VERSION,
} from '../../events/trip-created.v1.js';
import {
  TRIP_POSTPONED_V1_TYPE,
  TRIP_POSTPONED_V1_VERSION,
} from '../../events/trip-postponed.v1.js';
import {
  TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE,
  TRIP_OCCUPANCY_ALERT_DUE_V1_VERSION,
} from '../../events/trip-occupancy-alert-due.v1.js';
import {
  TRIP_OCCUPANCY_URGENCY_DUE_V1_TYPE,
  TRIP_OCCUPANCY_URGENCY_DUE_V1_VERSION,
} from '../../events/trip-occupancy-urgency-due.v1.js';
import {
  createNotificationFanoutHandler,
  type NotificationFanoutDeps,
  type NotificationFanoutEvent,
} from './notification-fanout.handler.js';
import { buildDefaultHandlers, resolveHandler } from './index.js';

const EVENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TRIP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ROUTE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AGENCY_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const AGENCY_B = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const RES_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

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

function reservationRow(): OutboxEventRow {
  return {
    id: EVENT_ID,
    event_type: RESERVATION_CREATED_V1_TYPE,
    event_version: RESERVATION_CREATED_V1_VERSION,
    aggregate_type: 'reservation',
    aggregate_id: RES_ID,
    tenant_id: AGENCY_A,
    payload: {
      reservation_id: RES_ID,
      trip_id: TRIP_ID,
      agency_id: AGENCY_A,
    },
    status: 'processing',
    attempts: 1,
    available_at: '2026-08-10T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-10T12:00:00.000Z',
    updated_at: '2026-08-10T12:00:00.000Z',
  };
}

function makeDeps(
  overrides: Partial<NotificationFanoutDeps> = {},
): NotificationFanoutDeps {
  return {
    isEffectsEnabled: () => true,
    filterAgencyNotificationRows: vi.fn(async (rows) => rows),
    findExistingBySourceEventId: vi.fn(async () => []),
    insertNotificationRows: vi.fn(async () => ({ error: null })),
    loadRoute: vi.fn(async () => ({
      origin: 'Caracas',
      destination: 'Mérida',
    })),
    loadReservationContext: vi.fn(async () => ({
      booker_name: 'Ana',
      passenger_count: 2,
      trip_id: TRIP_ID,
      origin: 'Caracas',
      destination: 'Mérida',
    })),
    formatDeparture: () => 'viernes, 10 de agosto de 2026, 08:00',
    ...overrides,
  };
}

const tripPayloadBase = {
  trip_id: TRIP_ID,
  route_id: ROUTE_ID,
  departure_time: '2026-08-15T12:00:00.000Z',
  agency_ids: [AGENCY_A, AGENCY_B],
};

describe('WKR-007 C4 — NotificationFanout', () => {
  it('skips when TRIP_EFFECTS_VIA_OUTBOX is disabled', async () => {
    const deps = makeDeps({ isEffectsEnabled: () => false });
    const handler = createNotificationFanoutHandler('trip.created', deps);

    await expect(
      handler(
        tripRow(TRIP_CREATED_V1_TYPE, TRIP_CREATED_V1_VERSION, {
          ...tripPayloadBase,
          vehicle_type: 'bus',
          capacity: 31,
        }),
      ),
    ).resolves.toEqual({
      kind: 'completed',
      reason: 'skipped_effect_disabled',
    });
    expect(deps.insertNotificationRows).not.toHaveBeenCalled();
  });

  const cases: Array<{
    event: NotificationFanoutEvent;
    type: string;
    version: number;
    payload: Record<string, unknown>;
    expectType: string;
    expectTitle: string;
    expectSuperadmin: boolean;
  }> = [
    {
      event: 'trip.created',
      type: TRIP_CREATED_V1_TYPE,
      version: TRIP_CREATED_V1_VERSION,
      payload: { ...tripPayloadBase, vehicle_type: 'bus', capacity: 31 },
      expectType: 'trip_created',
      expectTitle: 'Viaje creado',
      expectSuperadmin: false,
    },
    {
      event: 'trip.postponed',
      type: TRIP_POSTPONED_V1_TYPE,
      version: TRIP_POSTPONED_V1_VERSION,
      payload: {
        ...tripPayloadBase,
        previous_departure_time: '2026-08-14T12:00:00.000Z',
      },
      expectType: 'trip_postponed',
      expectTitle: 'Viaje pospuesto',
      expectSuperadmin: false,
    },
    {
      event: 'trip.cancelled',
      type: TRIP_CANCELLED_V1_TYPE,
      version: TRIP_CANCELLED_V1_VERSION,
      payload: { ...tripPayloadBase, status: 'cancelled' },
      expectType: 'trip_cancelled',
      expectTitle: 'Viaje cancelado',
      expectSuperadmin: false,
    },
    {
      event: 'trip.completed',
      type: TRIP_COMPLETED_V1_TYPE,
      version: TRIP_COMPLETED_V1_VERSION,
      payload: { ...tripPayloadBase, status: 'completed' },
      expectType: 'trip_completed',
      expectTitle: 'Viaje completado',
      expectSuperadmin: false,
    },
    {
      event: 'trip.auto_completed',
      type: TRIP_AUTO_COMPLETED_V1_TYPE,
      version: TRIP_AUTO_COMPLETED_V1_VERSION,
      payload: { ...tripPayloadBase, status: 'completed', source: 'auto' },
      expectType: 'trip_auto_completed',
      expectTitle: 'Viaje completado automáticamente',
      expectSuperadmin: true,
    },
    {
      event: 'trip.archived',
      type: TRIP_ARCHIVED_V1_TYPE,
      version: TRIP_ARCHIVED_V1_VERSION,
      payload: { ...tripPayloadBase, status: 'archived' },
      expectType: 'trip_archived',
      expectTitle: 'Viaje archivado',
      expectSuperadmin: false,
    },
  ];

  it.each(cases)(
    'delivers $event to agencies with correct notification type',
    async ({
      event,
      type,
      version,
      payload,
      expectType,
      expectTitle,
      expectSuperadmin,
    }) => {
      const deps = makeDeps();
      const handler = createNotificationFanoutHandler(event, deps);

      const outcome = await handler(tripRow(type, version, payload));

      expect(outcome).toEqual({ kind: 'completed', reason: 'delivered' });
      expect(deps.insertNotificationRows).toHaveBeenCalledOnce();
      const rows = vi.mocked(deps.insertNotificationRows).mock.calls[0][0];
      expect(rows.every((r) => r.type === expectType)).toBe(true);
      expect(rows.every((r) => r.title === expectTitle)).toBe(true);
      expect(rows.every((r) => r.source_event_id === EVENT_ID)).toBe(true);
      expect(
        rows.filter((r) => r.recipient_role === 'agency').map((r) => r.agency_id),
      ).toEqual([AGENCY_A, AGENCY_B]);
      const adminRows = rows.filter((r) => r.recipient_role === 'superadmin');
      expect(adminRows.length).toBe(expectSuperadmin ? 1 : 0);
    },
  );

  it('creates reservation_created for superadmin only', async () => {
    const deps = makeDeps();
    const handler = createNotificationFanoutHandler(
      'reservation.created',
      deps,
    );

    const outcome = await handler(reservationRow());

    expect(outcome).toEqual({ kind: 'completed', reason: 'delivered' });
    const rows = vi.mocked(deps.insertNotificationRows).mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'reservation_created',
      title: 'Nueva reserva',
      recipient_role: 'superadmin',
      agency_id: null,
      entity_id: RES_ID,
      source_event_id: EVENT_ID,
    });
    expect(rows[0].body).toContain('Ana');
    expect(rows[0].body).toContain('2 pasajeros');
  });

  it('returns already_delivered when source_event_id rows already exist', async () => {
    const deps = makeDeps({
      findExistingBySourceEventId: vi.fn(async () => [
        { agency_id: AGENCY_A, recipient_role: 'agency' },
        { agency_id: AGENCY_B, recipient_role: 'agency' },
      ]),
    });
    const handler = createNotificationFanoutHandler('trip.created', deps);

    await expect(
      handler(
        tripRow(TRIP_CREATED_V1_TYPE, TRIP_CREATED_V1_VERSION, {
          ...tripPayloadBase,
          vehicle_type: 'bus',
          capacity: 31,
        }),
      ),
    ).resolves.toEqual({ kind: 'completed', reason: 'already_delivered' });
    expect(deps.insertNotificationRows).not.toHaveBeenCalled();
  });

  it('does not convert insert failures into success', async () => {
    const deps = makeDeps({
      insertNotificationRows: vi.fn(async () => ({
        error: { message: 'insert failed', code: '42000' },
      })),
    });
    const handler = createNotificationFanoutHandler('trip.cancelled', deps);

    await expect(
      handler(
        tripRow(TRIP_CANCELLED_V1_TYPE, TRIP_CANCELLED_V1_VERSION, {
          ...tripPayloadBase,
          status: 'cancelled',
        }),
      ),
    ).resolves.toEqual({
      kind: 'failed',
      permanent: false,
      reason: 'insert failed',
    });
  });

  it('treats unique violations as already_delivered', async () => {
    const deps = makeDeps({
      insertNotificationRows: vi.fn(async () => ({
        error: { message: 'duplicate', code: '23505' },
      })),
    });
    const handler = createNotificationFanoutHandler('trip.completed', deps);

    await expect(
      handler(
        tripRow(TRIP_COMPLETED_V1_TYPE, TRIP_COMPLETED_V1_VERSION, {
          ...tripPayloadBase,
          status: 'completed',
        }),
      ),
    ).resolves.toEqual({ kind: 'completed', reason: 'already_delivered' });
  });

  it('respects delivery policy filtering (fail-open is in policy)', async () => {
    const deps = makeDeps({
      filterAgencyNotificationRows: vi.fn(async (rows) =>
        rows.filter((r) => r.agency_id !== AGENCY_B),
      ),
    });
    const handler = createNotificationFanoutHandler('trip.created', deps);

    await handler(
      tripRow(TRIP_CREATED_V1_TYPE, TRIP_CREATED_V1_VERSION, {
        ...tripPayloadBase,
        vehicle_type: 'bus',
        capacity: 31,
      }),
    );

    const rows = vi.mocked(deps.insertNotificationRows).mock.calls[0][0];
    expect(rows.map((r) => r.agency_id)).toEqual([AGENCY_A]);
  });

  it('fails permanently on invalid payload (no silent success)', async () => {
    const deps = makeDeps();
    const handler = createNotificationFanoutHandler('trip.created', deps);

    await expect(
      handler(
        tripRow(TRIP_CREATED_V1_TYPE, TRIP_CREATED_V1_VERSION, {
          trip_id: TRIP_ID,
          // missing required fields
        }),
      ),
    ).resolves.toMatchObject({
      kind: 'failed',
      permanent: true,
    });
    expect(deps.insertNotificationRows).not.toHaveBeenCalled();
  });
});

describe('WKR-007 C4 — registry wiring', () => {
  it('registers notification fanout for reservation.created and trip.* (C5 email composed alongside)', () => {
    const handlers = buildDefaultHandlers();

    const expectedKeys = [
      `${RESERVATION_CREATED_V1_TYPE}:${RESERVATION_CREATED_V1_VERSION}`,
      `${TRIP_CREATED_V1_TYPE}:${TRIP_CREATED_V1_VERSION}`,
      `${TRIP_POSTPONED_V1_TYPE}:${TRIP_POSTPONED_V1_VERSION}`,
      `${TRIP_CANCELLED_V1_TYPE}:${TRIP_CANCELLED_V1_VERSION}`,
      `${TRIP_COMPLETED_V1_TYPE}:${TRIP_COMPLETED_V1_VERSION}`,
      `${TRIP_AUTO_COMPLETED_V1_TYPE}:${TRIP_AUTO_COMPLETED_V1_VERSION}`,
      `${TRIP_ARCHIVED_V1_TYPE}:${TRIP_ARCHIVED_V1_VERSION}`,
    ];

    for (const key of expectedKeys) {
      expect(handlers.has(key)).toBe(true);
      expect(resolveHandler(handlers, key.split(':')[0], 1)).toBeTypeOf(
        'function',
      );
    }

    // No trip.updated consumer (out of C4/C5 notification+email scope)
    expect(handlers.has('trip.updated:1')).toBe(false);

    const indexSource = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts'),
      'utf8',
    );
    expect(indexSource).toContain('notification-fanout.handler');
    expect(indexSource).toContain('email-fanout.handler');
    expect(indexSource).not.toContain('reservationNotificationPlaceholder');
  });

  it('composed reservation.created still keeps email handler and skips fanout when flag false', async () => {
    const handlers = buildDefaultHandlers();
    const handler = resolveHandler(
      handlers,
      RESERVATION_CREATED_V1_TYPE,
      RESERVATION_CREATED_V1_VERSION,
    );
    expect(handler).toBeTypeOf('function');

    // Flag default in mock is false → notification fanout completes as skipped.
    // Email handler will fail permanently on reservation-not-found (mocked DB),
    // so aggregate is failed — assert fanout itself is skipped via direct call.
    const fanout = createNotificationFanoutHandler('reservation.created', {
      ...makeDeps({ isEffectsEnabled: () => false }),
    });
    await expect(fanout(reservationRow())).resolves.toEqual({
      kind: 'completed',
      reason: 'skipped_effect_disabled',
    });
  });
});

describe('F4-003 — occupancy NotificationFanout', () => {
  const occupancyPayload = {
    trip_id: TRIP_ID,
    alert_type: 'near_full' as const,
    occupancy_pct: 93,
    departure_time: '2026-08-15T12:00:00.000Z',
    route_id: ROUTE_ID,
  };

  it('skips when OCCUPANCY_ALERT_VIA_WORKER gate is false', async () => {
    const deps = makeDeps({ isEffectsEnabled: () => false });
    const handler = createNotificationFanoutHandler('trip.occupancy_alert', deps);

    await expect(
      handler(
        tripRow(
          TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE,
          TRIP_OCCUPANCY_ALERT_DUE_V1_VERSION,
          occupancyPayload,
        ),
      ),
    ).resolves.toEqual({
      kind: 'completed',
      reason: 'skipped_effect_disabled',
    });
    expect(deps.insertNotificationRows).not.toHaveBeenCalled();
  });

  it('fans out to associated agencies + unconditional superadmin with role-specific action_url', async () => {
    const deps = makeDeps({
      loadTripAgencyIds: vi.fn(async () => [AGENCY_A, AGENCY_B]),
      loadLiveOccupancy: vi.fn(async () => ({
        reserved: 9,
        total: 10,
        available: 1,
        occupancy_pct: 90,
      })),
    });
    const handler = createNotificationFanoutHandler('trip.occupancy_alert', deps);

    await expect(
      handler(
        tripRow(
          TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE,
          TRIP_OCCUPANCY_ALERT_DUE_V1_VERSION,
          occupancyPayload,
        ),
      ),
    ).resolves.toEqual({ kind: 'completed', reason: 'delivered' });

    const rows = vi.mocked(deps.insertNotificationRows).mock.calls[0][0];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.type)).toEqual([
      'occupancy_alert',
      'occupancy_alert',
      'occupancy_alert',
    ]);
    expect(rows[0]).toMatchObject({
      agency_id: AGENCY_A,
      recipient_role: 'agency',
      action_url: `/agency/trips/${TRIP_ID}/passengers`,
      source_event_id: EVENT_ID,
      metadata: {
        alert_type: 'near_full',
        occupancy_pct: 90,
        trip_id: TRIP_ID,
      },
    });
    expect(rows[1]).toMatchObject({
      agency_id: AGENCY_B,
      recipient_role: 'agency',
      action_url: `/agency/trips/${TRIP_ID}/passengers`,
    });
    expect(rows[2]).toMatchObject({
      agency_id: null,
      recipient_role: 'superadmin',
      action_url: `/admin/trips/${TRIP_ID}`,
    });
    expect(deps.loadTripAgencyIds).toHaveBeenCalledWith(TRIP_ID);
  });

  it('still inserts superadmin when no agencies are associated', async () => {
    const deps = makeDeps({
      loadTripAgencyIds: vi.fn(async () => []),
    });
    const handler = createNotificationFanoutHandler('trip.occupancy_alert', deps);

    await expect(
      handler(
        tripRow(
          TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE,
          TRIP_OCCUPANCY_ALERT_DUE_V1_VERSION,
          {
            ...occupancyPayload,
            alert_type: 'underbooked',
            occupancy_pct: 15,
          },
        ),
      ),
    ).resolves.toEqual({ kind: 'completed', reason: 'delivered' });

    const rows = vi.mocked(deps.insertNotificationRows).mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient_role: 'superadmin',
      agency_id: null,
      action_url: `/admin/trips/${TRIP_ID}`,
      title: 'Viaje con pocas reservas',
    });
    expect(rows[0].body).toMatch(/^Mérida el /);
    expect(rows[0].body).not.toMatch(/Caracas →/);
  });

  it('filters disabled agency prefs but keeps superadmin row', async () => {
    const deps = makeDeps({
      loadTripAgencyIds: vi.fn(async () => [AGENCY_A, AGENCY_B]),
      filterAgencyNotificationRows: vi.fn(async (rows) =>
        rows.filter(
          (row) =>
            row.recipient_role !== 'agency' || row.agency_id !== AGENCY_A,
        ),
      ),
    });
    const handler = createNotificationFanoutHandler('trip.occupancy_alert', deps);

    await expect(
      handler(
        tripRow(
          TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE,
          TRIP_OCCUPANCY_ALERT_DUE_V1_VERSION,
          occupancyPayload,
        ),
      ),
    ).resolves.toEqual({ kind: 'completed', reason: 'delivered' });

    const rows = vi.mocked(deps.insertNotificationRows).mock.calls[0][0];
    expect(rows.map((r) => r.agency_id)).toEqual([AGENCY_B, null]);
  });

  it('is idempotent on partial delivery via source_event_id', async () => {
    const deps = makeDeps({
      loadTripAgencyIds: vi.fn(async () => [AGENCY_A]),
      findExistingBySourceEventId: vi.fn(async () => [
        { agency_id: AGENCY_A, recipient_role: 'agency' },
      ]),
    });
    const handler = createNotificationFanoutHandler('trip.occupancy_alert', deps);

    await expect(
      handler(
        tripRow(
          TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE,
          TRIP_OCCUPANCY_ALERT_DUE_V1_VERSION,
          occupancyPayload,
        ),
      ),
    ).resolves.toEqual({ kind: 'completed', reason: 'delivered' });

    const rows = vi.mocked(deps.insertNotificationRows).mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient_role: 'superadmin',
      agency_id: null,
    });
  });

  it('registers occupancy handler without email path', () => {
    const handlers = buildDefaultHandlers();
    expect(
      handlers.has(
        `${TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE}:${TRIP_OCCUPANCY_ALERT_DUE_V1_VERSION}`,
      ),
    ).toBe(true);

    const indexSource = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts'),
      'utf8',
    );
    const block = indexSource.split('F4-003')[1] ?? '';
    expect(block).toContain('trip.occupancy_alert');
    expect(block).not.toContain('createEmailFanoutHandler');
    expect(block).not.toContain('email_delivery_log');
  });
});

describe('F4-004 — occupancy urgency NotificationFanout', () => {
  const urgencyPayload = {
    trip_id: TRIP_ID,
    alert_type: 'near_full' as const,
    occupancy_pct: 94,
    departure_time: '2026-08-15T12:00:00.000Z',
    route_id: ROUTE_ID,
    urgency_window: 't24' as const,
  };

  it('skips when OCCUPANCY_URGENCY_VIA_WORKER gate is false', async () => {
    const deps = makeDeps({ isEffectsEnabled: () => false });
    const handler = createNotificationFanoutHandler('trip.occupancy_urgency', deps);

    await expect(
      handler(
        tripRow(
          TRIP_OCCUPANCY_URGENCY_DUE_V1_TYPE,
          TRIP_OCCUPANCY_URGENCY_DUE_V1_VERSION,
          urgencyPayload,
        ),
      ),
    ).resolves.toEqual({
      kind: 'completed',
      reason: 'skipped_effect_disabled',
    });
    expect(deps.insertNotificationRows).not.toHaveBeenCalled();
  });

  it('fans out urgency with Sale mañana copy, metadata, and role action_urls', async () => {
    const deps = makeDeps({
      loadTripAgencyIds: vi.fn(async () => [AGENCY_A]),
      loadLiveOccupancy: vi.fn(async () => ({
        reserved: 29,
        total: 31,
        available: 2,
        occupancy_pct: 94,
      })),
    });
    const handler = createNotificationFanoutHandler('trip.occupancy_urgency', deps);

    await expect(
      handler(
        tripRow(
          TRIP_OCCUPANCY_URGENCY_DUE_V1_TYPE,
          TRIP_OCCUPANCY_URGENCY_DUE_V1_VERSION,
          urgencyPayload,
        ),
      ),
    ).resolves.toEqual({ kind: 'completed', reason: 'delivered' });

    const rows = vi.mocked(deps.insertNotificationRows).mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      type: 'occupancy_alert',
      agency_id: AGENCY_A,
      recipient_role: 'agency',
      title: 'Viaje casi lleno — sale mañana',
      body: 'Mérida sale mañana · 94% (29/31)',
      action_url: `/agency/trips/${TRIP_ID}/passengers`,
      metadata: {
        alert_type: 'near_full',
        occupancy_pct: 94,
        trip_id: TRIP_ID,
        urgency: true,
        urgency_window: 't24',
      },
    });
    expect(rows[1]).toMatchObject({
      recipient_role: 'superadmin',
      agency_id: null,
      action_url: `/admin/trips/${TRIP_ID}`,
      title: 'Viaje casi lleno — sale mañana',
    });
  });

  it('uses underbooked urgency title', async () => {
    const deps = makeDeps({
      loadTripAgencyIds: vi.fn(async () => []),
    });
    const handler = createNotificationFanoutHandler('trip.occupancy_urgency', deps);

    await expect(
      handler(
        tripRow(
          TRIP_OCCUPANCY_URGENCY_DUE_V1_TYPE,
          TRIP_OCCUPANCY_URGENCY_DUE_V1_VERSION,
          {
            ...urgencyPayload,
            alert_type: 'underbooked',
            occupancy_pct: 12,
          },
        ),
      ),
    ).resolves.toEqual({ kind: 'completed', reason: 'delivered' });

    const rows = vi.mocked(deps.insertNotificationRows).mock.calls[0][0];
    expect(rows[0]).toMatchObject({
      recipient_role: 'superadmin',
      title: 'Viaje con pocas reservas — sale mañana',
      body: expect.stringMatching(/^Mérida sale mañana · /),
    });
  });

  it('registers urgency handler without email path', () => {
    const handlers = buildDefaultHandlers();
    expect(
      handlers.has(
        `${TRIP_OCCUPANCY_URGENCY_DUE_V1_TYPE}:${TRIP_OCCUPANCY_URGENCY_DUE_V1_VERSION}`,
      ),
    ).toBe(true);

    const indexSource = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts'),
      'utf8',
    );
    expect(indexSource).toContain('trip.occupancy_urgency');
    expect(indexSource).toContain('OCCUPANCY_URGENCY_VIA_WORKER');
    const f4004 = indexSource.split('F4-004')[1] ?? '';
    expect(f4004).not.toContain('createEmailFanoutHandler');
  });
});
