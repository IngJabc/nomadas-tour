import { describe, expect, it } from 'vitest';
import type { OutboxEventRow } from './types.js';
import { TRIP_EVENT_AGGREGATE, assertNoPiiInTripPayload } from './trip-common.js';
import {
  TRIP_REMINDER_DUE_V1_TYPE,
  TRIP_REMINDER_DUE_V1_VERSION,
  isTripReminderDuePayloadV1,
  parseTripReminderDueEventV1,
} from './trip-reminder-due.v1.js';

const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const ROUTE_ID = '22222222-2222-2222-2222-222222222222';
const AGENCY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function row(
  payload: Record<string, unknown>,
  overrides: Partial<OutboxEventRow> = {},
): OutboxEventRow {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    event_type: TRIP_REMINDER_DUE_V1_TYPE,
    event_version: TRIP_REMINDER_DUE_V1_VERSION,
    aggregate_type: TRIP_EVENT_AGGREGATE,
    aggregate_id: TRIP_ID,
    tenant_id: null,
    payload,
    status: 'pending',
    attempts: 0,
    available_at: '2026-08-11T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-11T12:00:00.000Z',
    updated_at: '2026-08-11T12:00:00.000Z',
    ...overrides,
  };
}

const basePayload = {
  trip_id: TRIP_ID,
  route_id: ROUTE_ID,
  departure_time: '2026-08-15T20:00:00.000Z',
  window: 't48' as const,
  agency_ids: [AGENCY_A],
};

describe('WKR-008 — trip.reminder_due.v1 contract', () => {
  it('accepts t48 and t24 payloads', () => {
    expect(isTripReminderDuePayloadV1(basePayload)).toBe(true);
    expect(
      isTripReminderDuePayloadV1({ ...basePayload, window: 't24' }),
    ).toBe(true);
  });

  it('rejects invalid window or missing fields', () => {
    expect(
      isTripReminderDuePayloadV1({ ...basePayload, window: 't2' }),
    ).toBe(false);
    expect(
      isTripReminderDuePayloadV1({ ...basePayload, window: 't22' }),
    ).toBe(false);
    expect(
      isTripReminderDuePayloadV1({ ...basePayload, window: undefined }),
    ).toBe(false);
    expect(
      isTripReminderDuePayloadV1({
        trip_id: TRIP_ID,
        route_id: ROUTE_ID,
        departure_time: '2026-08-15T20:00:00.000Z',
        window: 't48',
      }),
    ).toBe(false);
  });

  it('parses envelope for t48 and t24', () => {
    const t48 = parseTripReminderDueEventV1(row(basePayload));
    expect(t48.type).toBe(TRIP_REMINDER_DUE_V1_TYPE);
    expect(t48.data.window).toBe('t48');
    expect(t48.tenant.agency_id).toBeNull();

    const t24 = parseTripReminderDueEventV1(
      row({ ...basePayload, window: 't24' }),
    );
    expect(t24.data.window).toBe('t24');
  });

  it('rejects tenant_id non-null and trip_id mismatch', () => {
    expect(() =>
      parseTripReminderDueEventV1(row(basePayload, { tenant_id: AGENCY_A })),
    ).toThrow(/tenant_id NULL/);
    expect(() =>
      parseTripReminderDueEventV1(
        row({ ...basePayload, trip_id: '99999999-9999-9999-9999-999999999999' }),
      ),
    ).toThrow(/payload.trip_id must match aggregate_id/);
  });

  it('rejects PII keys in payload', () => {
    expect(
      assertNoPiiInTripPayload({
        ...basePayload,
        contact_email: 'x@y.com',
      }),
    ).toBe(false);
    expect(() =>
      parseTripReminderDueEventV1(
        row({ ...basePayload, booker_name: 'Ana' }),
      ),
    ).toThrow(/PII/);
  });
});
