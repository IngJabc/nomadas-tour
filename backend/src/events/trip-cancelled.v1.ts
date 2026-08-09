import {
  type EventEnvelope,
  type OutboxEventRow,
} from './types.js';
import {
  TRIP_EVENT_AGGREGATE,
  assertNoPiiInTripPayload,
  isStringArray,
  parseTripEventV1,
} from './trip-common.js';

/** Logical identifier: trip.cancelled.v1 */
export const TRIP_CANCELLED_V1_TYPE = 'trip.cancelled' as const;
export const TRIP_CANCELLED_V1_VERSION = 1 as const;
export const TRIP_CANCELLED_V1_AGGREGATE = TRIP_EVENT_AGGREGATE;

export interface TripCancelledDataV1 {
  trip_id: string;
  route_id: string;
  departure_time: string;
  status: 'cancelled';
  agency_ids: string[];
}

export type TripCancelledEventV1 = EventEnvelope<TripCancelledDataV1>;

export function isTripCancelledPayloadV1(
  value: unknown,
): value is TripCancelledDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.trip_id === 'string' &&
    typeof row.route_id === 'string' &&
    typeof row.departure_time === 'string' &&
    row.status === 'cancelled' &&
    isStringArray(row.agency_ids)
  );
}

export function assertNoPiiInTripCancelledPayload(
  payload: Record<string, unknown>,
): boolean {
  return assertNoPiiInTripPayload(payload);
}

export function parseTripCancelledEventV1(
  row: OutboxEventRow,
): TripCancelledEventV1 {
  return parseTripEventV1(
    row,
    TRIP_CANCELLED_V1_TYPE,
    TRIP_CANCELLED_V1_VERSION,
    isTripCancelledPayloadV1,
  );
}
