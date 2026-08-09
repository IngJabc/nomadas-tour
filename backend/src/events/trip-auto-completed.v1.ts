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

/** Logical identifier: trip.auto_completed.v1 (system) */
export const TRIP_AUTO_COMPLETED_V1_TYPE = 'trip.auto_completed' as const;
export const TRIP_AUTO_COMPLETED_V1_VERSION = 1 as const;
export const TRIP_AUTO_COMPLETED_V1_AGGREGATE = TRIP_EVENT_AGGREGATE;

/**
 * Same shape as trip.completed.v1 plus source: 'auto' (emitted by the
 * completeExpiredTrips timer path via the complete_trip RPC).
 */
export interface TripAutoCompletedDataV1 {
  trip_id: string;
  route_id: string;
  departure_time: string;
  status: 'completed';
  source: 'auto';
  agency_ids: string[];
}

export type TripAutoCompletedEventV1 = EventEnvelope<TripAutoCompletedDataV1>;

export function isTripAutoCompletedPayloadV1(
  value: unknown,
): value is TripAutoCompletedDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.trip_id === 'string' &&
    typeof row.route_id === 'string' &&
    typeof row.departure_time === 'string' &&
    row.status === 'completed' &&
    row.source === 'auto' &&
    isStringArray(row.agency_ids)
  );
}

export function assertNoPiiInTripAutoCompletedPayload(
  payload: Record<string, unknown>,
): boolean {
  return assertNoPiiInTripPayload(payload);
}

export function parseTripAutoCompletedEventV1(
  row: OutboxEventRow,
): TripAutoCompletedEventV1 {
  return parseTripEventV1(
    row,
    TRIP_AUTO_COMPLETED_V1_TYPE,
    TRIP_AUTO_COMPLETED_V1_VERSION,
    isTripAutoCompletedPayloadV1,
  );
}
