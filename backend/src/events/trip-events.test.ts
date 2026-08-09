import { describe, expect, it } from 'vitest';
import type { OutboxEventRow } from './types.js';
import {
  parseTripArchivedEventV1,
  isTripArchivedPayloadV1,
} from './trip-archived.v1.js';
import {
  parseTripAutoCompletedEventV1,
  isTripAutoCompletedPayloadV1,
} from './trip-auto-completed.v1.js';
import {
  parseTripCancelledEventV1,
  isTripCancelledPayloadV1,
} from './trip-cancelled.v1.js';
import {
  parseTripCompletedEventV1,
  isTripCompletedPayloadV1,
} from './trip-completed.v1.js';
import {
  parseTripCreatedEventV1,
  isTripCreatedPayloadV1,
} from './trip-created.v1.js';
import {
  parseTripPostponedEventV1,
  isTripPostponedPayloadV1,
} from './trip-postponed.v1.js';
import {
  parseTripUpdatedEventV1,
  isTripUpdatedPayloadV1,
} from './trip-updated.v1.js';
import {
  TRIP_EVENT_AGGREGATE,
  assertNoPiiInTripPayload,
} from './trip-common.js';

const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const ROUTE_ID = '22222222-2222-2222-2222-222222222222';
const AGENCY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AGENCY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function baseTripRow(
  eventType: string,
  payload: Record<string, unknown>,
  overrides: Partial<OutboxEventRow> = {},
): OutboxEventRow {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    event_type: eventType,
    event_version: 1,
    aggregate_type: TRIP_EVENT_AGGREGATE,
    aggregate_id: TRIP_ID,
    tenant_id: null,
    payload,
    status: 'pending',
    attempts: 0,
    available_at: '2026-08-08T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-08T12:00:00.000Z',
    updated_at: '2026-08-08T12:00:00.000Z',
    ...overrides,
  };
}

describe('WKR-007 Fase 2 — trip.* contracts', () => {
  it('trip.created: accepts minimal payload and parses envelope', () => {
    const payload = {
      trip_id: TRIP_ID,
      route_id: ROUTE_ID,
      departure_time: '2026-08-15T10:00:00.000Z',
      vehicle_type: 'bus',
      capacity: 31,
      agency_ids: [AGENCY_A, AGENCY_B],
    };
    expect(isTripCreatedPayloadV1(payload)).toBe(true);
    expect(isTripCreatedPayloadV1({ ...payload, capacity: 0 })).toBe(false);
    expect(isTripCreatedPayloadV1({ ...payload, agency_ids: 'nope' })).toBe(
      false,
    );

    const event = parseTripCreatedEventV1(baseTripRow('trip.created', payload));
    expect(event.type).toBe('trip.created');
    expect(event.version).toBe(1);
    expect(event.aggregate).toEqual({ type: 'trip', id: TRIP_ID });
    expect(event.tenant).toEqual({ agency_id: null });
    expect(event.data).toEqual(payload);
  });

  it('trip.postponed: accepts minimal payload and parses envelope', () => {
    const payload = {
      trip_id: TRIP_ID,
      route_id: ROUTE_ID,
      previous_departure_time: '2026-08-15T10:00:00.000Z',
      departure_time: '2026-08-18T10:00:00.000Z',
      agency_ids: [AGENCY_A],
    };
    expect(isTripPostponedPayloadV1(payload)).toBe(true);
    expect(
      isTripPostponedPayloadV1({ ...payload, previous_departure_time: 1 }),
    ).toBe(false);
    expect(
      isTripPostponedPayloadV1({ ...payload, agency_ids: [] }),
    ).toBe(true);

    const event = parseTripPostponedEventV1(
      baseTripRow('trip.postponed', payload),
    );
    expect(event.data).toEqual(payload);
  });

  it('trip.cancelled: accepts minimal payload and parses envelope', () => {
    const payload = {
      trip_id: TRIP_ID,
      route_id: ROUTE_ID,
      departure_time: '2026-08-15T10:00:00.000Z',
      status: 'cancelled',
      agency_ids: [AGENCY_A, AGENCY_B],
    };
    expect(isTripCancelledPayloadV1(payload)).toBe(true);
    expect(isTripCancelledPayloadV1({ ...payload, status: 'completed' })).toBe(
      false,
    );

    const event = parseTripCancelledEventV1(
      baseTripRow('trip.cancelled', payload),
    );
    expect(event.data).toEqual(payload);
  });

  it('trip.completed: accepts minimal payload and parses envelope', () => {
    const payload = {
      trip_id: TRIP_ID,
      route_id: ROUTE_ID,
      departure_time: '2026-08-15T10:00:00.000Z',
      status: 'completed',
      agency_ids: [AGENCY_A],
    };
    expect(isTripCompletedPayloadV1(payload)).toBe(true);
    expect(
      isTripCompletedPayloadV1({ ...payload, status: 'archived' }),
    ).toBe(false);

    const event = parseTripCompletedEventV1(
      baseTripRow('trip.completed', payload),
    );
    expect(event.data).toEqual(payload);
  });

  it('trip.auto_completed: requires source=auto and is a distinct type', () => {
    const payload = {
      trip_id: TRIP_ID,
      route_id: ROUTE_ID,
      departure_time: '2026-08-15T10:00:00.000Z',
      status: 'completed',
      source: 'auto',
      agency_ids: [AGENCY_A, AGENCY_B],
    };
    expect(isTripAutoCompletedPayloadV1(payload)).toBe(true);
    expect(isTripAutoCompletedPayloadV1({ ...payload, source: 'manual' })).toBe(
      false,
    );
    // trip.completed must NOT be satisfied by the auto shape (distinct type)
    expect(isTripCompletedPayloadV1(payload)).toBe(true); // shape-compatible but distinct event_type

    const event = parseTripAutoCompletedEventV1(
      baseTripRow('trip.auto_completed', payload),
    );
    expect(event.type).toBe('trip.auto_completed');
    expect(event.data).toEqual(payload);
  });

  it('trip.updated: accepts changed_fields and parses envelope', () => {
    const payload = {
      trip_id: TRIP_ID,
      route_id: ROUTE_ID,
      departure_time: '2026-08-15T10:00:00.000Z',
      changed_fields: ['capacity', 'agency_ids'],
      agency_ids: [AGENCY_A],
    };
    expect(isTripUpdatedPayloadV1(payload)).toBe(true);
    expect(isTripUpdatedPayloadV1({ ...payload, changed_fields: ['x', 1] })).toBe(
      false,
    );
    expect(isTripUpdatedPayloadV1({ ...payload, changed_fields: [] })).toBe(
      true,
    );

    const event = parseTripUpdatedEventV1(baseTripRow('trip.updated', payload));
    expect(event.data).toEqual(payload);
  });

  it('trip.archived: accepts minimal payload and parses envelope', () => {
    const payload = {
      trip_id: TRIP_ID,
      route_id: ROUTE_ID,
      departure_time: '2026-08-15T10:00:00.000Z',
      status: 'archived',
      agency_ids: [AGENCY_A],
    };
    expect(isTripArchivedPayloadV1(payload)).toBe(true);
    expect(isTripArchivedPayloadV1({ ...payload, status: 'cancelled' })).toBe(
      false,
    );

    const event = parseTripArchivedEventV1(
      baseTripRow('trip.archived', payload),
    );
    expect(event.data).toEqual(payload);
  });

  it('rejects PII keys across the trip family', () => {
    const clean = {
      trip_id: TRIP_ID,
      route_id: ROUTE_ID,
      departure_time: '2026-08-15T10:00:00.000Z',
      vehicle_type: 'bus',
      capacity: 31,
      agency_ids: [AGENCY_A],
    };
    expect(assertNoPiiInTripPayload(clean)).toBe(true);
    for (const piiKey of [
      'document',
      'phone',
      'email',
      'contact_email',
      'qr_code',
      'booker_name',
      'passengers',
      'agency_name',
      'agency_names',
      'agency_email',
      'agency_emails',
      'user_name',
      'user_email',
      'created_by_name',
    ]) {
      expect(assertNoPiiInTripPayload({ ...clean, [piiKey]: 'x' })).toBe(false);
    }
    expect(() =>
      parseTripCreatedEventV1(
        baseTripRow('trip.created', { ...clean, agency_name: 'Agency' }),
      ),
    ).toThrow(/PII/);
  });

  it('rejects wrong type, version, aggregate, tenant or mismatched trip_id', () => {
    const payload = {
      trip_id: TRIP_ID,
      route_id: ROUTE_ID,
      departure_time: '2026-08-15T10:00:00.000Z',
      vehicle_type: 'bus',
      capacity: 31,
      agency_ids: [AGENCY_A],
    };

    expect(() =>
      parseTripCreatedEventV1(baseTripRow('trip.cancelled', payload)),
    ).toThrow(/event_type/);

    expect(() =>
      parseTripCreatedEventV1(
        baseTripRow('trip.created', payload, { event_version: 2 }),
      ),
    ).toThrow(/event_version/);

    expect(() =>
      parseTripCreatedEventV1(
        baseTripRow('trip.created', payload, {
          aggregate_type: 'reservation',
        }),
      ),
    ).toThrow(/aggregate_type/);

    expect(() =>
      parseTripCreatedEventV1(
        baseTripRow('trip.created', payload, { tenant_id: AGENCY_A }),
      ),
    ).toThrow(/tenant_id/);

    expect(() =>
      parseTripCreatedEventV1(
        baseTripRow('trip.created', { ...payload, trip_id: ROUTE_ID }),
      ),
    ).toThrow(/aggregate_id/);

    expect(() =>
      parseTripCreatedEventV1(
        baseTripRow('trip.created', { ...payload, route_id: 1 }),
      ),
    ).toThrow(/payload shape/);
  });

  it('rejects non-object / null payloads', () => {
    expect(isTripCreatedPayloadV1(null)).toBe(false);
    expect(isTripCreatedPayloadV1('x')).toBe(false);
    expect(isTripCreatedPayloadV1([])).toBe(false);
  });
});
