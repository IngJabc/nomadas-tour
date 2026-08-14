import { describe, expect, it } from 'vitest';
import type { OutboxEventRow } from './types.js';
import { TRIP_EVENT_AGGREGATE, assertNoPiiInTripPayload } from './trip-common.js';
import {
  OCCUPANCY_URGENCY_WINDOW,
  TRIP_OCCUPANCY_URGENCY_DUE_V1_TYPE,
  TRIP_OCCUPANCY_URGENCY_DUE_V1_VERSION,
  isTripOccupancyUrgencyDuePayloadV1,
  parseTripOccupancyUrgencyDueEventV1,
  urgencyDedupKey,
} from './trip-occupancy-urgency-due.v1.js';

const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const ROUTE_ID = '22222222-2222-2222-2222-222222222222';

function row(
  payload: Record<string, unknown>,
  overrides: Partial<OutboxEventRow> = {},
): OutboxEventRow {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    event_type: TRIP_OCCUPANCY_URGENCY_DUE_V1_TYPE,
    event_version: TRIP_OCCUPANCY_URGENCY_DUE_V1_VERSION,
    aggregate_type: TRIP_EVENT_AGGREGATE,
    aggregate_id: TRIP_ID,
    tenant_id: null,
    payload,
    status: 'pending',
    attempts: 0,
    available_at: '2026-08-14T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-14T12:00:00.000Z',
    updated_at: '2026-08-14T12:00:00.000Z',
    ...overrides,
  };
}

const basePayload = {
  trip_id: TRIP_ID,
  alert_type: 'near_full' as const,
  occupancy_pct: 94,
  departure_time: '2026-08-15T12:00:00.000Z',
  route_id: ROUTE_ID,
  urgency_window: OCCUPANCY_URGENCY_WINDOW,
};

describe('F4-004 — trip.occupancy_urgency.due.v1 contract', () => {
  it('accepts near_full and underbooked payloads with urgency_window t24', () => {
    expect(isTripOccupancyUrgencyDuePayloadV1(basePayload)).toBe(true);
    expect(
      isTripOccupancyUrgencyDuePayloadV1({
        ...basePayload,
        alert_type: 'underbooked',
        occupancy_pct: 12,
      }),
    ).toBe(true);
  });

  it('rejects transition, invalid window, or missing fields', () => {
    expect(
      isTripOccupancyUrgencyDuePayloadV1({
        ...basePayload,
        transition: 'ENTER',
      }),
    ).toBe(false);
    expect(
      isTripOccupancyUrgencyDuePayloadV1({
        ...basePayload,
        urgency_window: 't48',
      }),
    ).toBe(false);
    expect(
      isTripOccupancyUrgencyDuePayloadV1({
        trip_id: TRIP_ID,
        alert_type: 'near_full',
        occupancy_pct: 94,
        departure_time: '2026-08-15T12:00:00.000Z',
        route_id: ROUTE_ID,
      }),
    ).toBe(false);
  });

  it('parses outbox row with tenant_id null and aggregate trip', () => {
    const parsed = parseTripOccupancyUrgencyDueEventV1(row(basePayload));
    expect(parsed.type).toBe(TRIP_OCCUPANCY_URGENCY_DUE_V1_TYPE);
    expect(parsed.version).toBe(1);
    expect(parsed.aggregate.type).toBe(TRIP_EVENT_AGGREGATE);
    expect(parsed.aggregate.id).toBe(TRIP_ID);
    expect(parsed.tenant.agency_id).toBeNull();
    expect(parsed.data.urgency_window).toBe('t24');
    expect(parsed.data.alert_type).toBe('near_full');
  });

  it('builds dedup key with departure for postponement cycles', () => {
    const departure = '2026-08-15T12:00:00.000000Z';
    expect(urgencyDedupKey(TRIP_ID, 'near_full', 't24', departure)).toBe(
      `trip.occupancy_urgency:${TRIP_ID}:near_full:t24:${departure}`,
    );
    expect(urgencyDedupKey(TRIP_ID, 'underbooked', 't24', departure)).toBe(
      `trip.occupancy_urgency:${TRIP_ID}:underbooked:t24:${departure}`,
    );
    const postponed = '2026-08-16T12:00:00.000000Z';
    expect(urgencyDedupKey(TRIP_ID, 'near_full', 't24', postponed)).not.toBe(
      urgencyDedupKey(TRIP_ID, 'near_full', 't24', departure),
    );
  });

  it('rejects PII-shaped keys via shared assert', () => {
    expect(
      assertNoPiiInTripPayload({
        ...basePayload,
        email: 'x@y.com',
      }),
    ).toBe(false);
  });
});
