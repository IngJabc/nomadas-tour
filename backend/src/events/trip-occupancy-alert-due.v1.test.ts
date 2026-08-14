import { describe, expect, it } from 'vitest';
import type { OutboxEventRow } from './types.js';
import { TRIP_EVENT_AGGREGATE, assertNoPiiInTripPayload } from './trip-common.js';
import {
  TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE,
  TRIP_OCCUPANCY_ALERT_DUE_V1_VERSION,
  isTripOccupancyAlertDuePayloadV1,
  occupancyAlertDedupKey,
  parseTripOccupancyAlertDueEventV1,
} from './trip-occupancy-alert-due.v1.js';

const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const ROUTE_ID = '22222222-2222-2222-2222-222222222222';
const AGENCY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function row(
  payload: Record<string, unknown>,
  overrides: Partial<OutboxEventRow> = {},
): OutboxEventRow {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    event_type: TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE,
    event_version: TRIP_OCCUPANCY_ALERT_DUE_V1_VERSION,
    aggregate_type: TRIP_EVENT_AGGREGATE,
    aggregate_id: TRIP_ID,
    tenant_id: null,
    payload,
    status: 'pending',
    attempts: 0,
    available_at: '2026-08-13T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-13T12:00:00.000Z',
    updated_at: '2026-08-13T12:00:00.000Z',
    ...overrides,
  };
}

const basePayload = {
  trip_id: TRIP_ID,
  alert_type: 'near_full' as const,
  occupancy_pct: 93,
  departure_time: '2026-08-15T20:00:00.000Z',
  route_id: ROUTE_ID,
};

describe('F4-003 — trip.occupancy_alert.due.v1 contract', () => {
  it('accepts near_full and underbooked payloads', () => {
    expect(isTripOccupancyAlertDuePayloadV1(basePayload)).toBe(true);
    expect(
      isTripOccupancyAlertDuePayloadV1({
        ...basePayload,
        alert_type: 'underbooked',
        occupancy_pct: 15,
      }),
    ).toBe(true);
  });

  it('rejects transition, invalid type, or missing fields', () => {
    expect(
      isTripOccupancyAlertDuePayloadV1({
        ...basePayload,
        transition: 'NORMAL_TO_NEAR_FULL',
      }),
    ).toBe(false);
    expect(
      isTripOccupancyAlertDuePayloadV1({
        ...basePayload,
        alert_type: 'almost_full',
      }),
    ).toBe(false);
    expect(
      isTripOccupancyAlertDuePayloadV1({
        trip_id: TRIP_ID,
        alert_type: 'near_full',
        occupancy_pct: 93,
      }),
    ).toBe(false);
  });

  it('parses envelope with aggregate trip and tenant_id NULL', () => {
    const parsed = parseTripOccupancyAlertDueEventV1(row(basePayload));
    expect(parsed.type).toBe(TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE);
    expect(parsed.version).toBe(1);
    expect(parsed.data.alert_type).toBe('near_full');
    expect(parsed.tenant.agency_id).toBeNull();
  });

  it('rejects tenant_id non-null and trip_id mismatch', () => {
    expect(() =>
      parseTripOccupancyAlertDueEventV1(row(basePayload, { tenant_id: AGENCY_A })),
    ).toThrow(/tenant_id NULL/);
    expect(() =>
      parseTripOccupancyAlertDueEventV1(
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
      parseTripOccupancyAlertDueEventV1(
        row({ ...basePayload, booker_name: 'Ana' }),
      ),
    ).toThrow(/PII/);
  });

  it('builds dedup_key from trip, alert type and updated_at token', () => {
    expect(
      occupancyAlertDedupKey(TRIP_ID, 'near_full', '2026-08-13T11:00:00.000000Z'),
    ).toBe(
      `trip.occupancy_alert:${TRIP_ID}:near_full:2026-08-13T11:00:00.000000Z`,
    );
  });
});
