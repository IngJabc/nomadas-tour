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

/** Logical identifier: trip.completed.v1 (manual) */
export const TRIP_COMPLETED_V1_TYPE = 'trip.completed' as const;
export const TRIP_COMPLETED_V1_VERSION = 1 as const;
export const TRIP_COMPLETED_V1_AGGREGATE = TRIP_EVENT_AGGREGATE;

export interface TripCompletedDataV1 {
  trip_id: string;
  route_id: string;
  departure_time: string;
  status: 'completed';
  agency_ids: string[];
}

export type TripCompletedEventV1 = EventEnvelope<TripCompletedDataV1>;

export function isTripCompletedPayloadV1(
  value: unknown,
): value is TripCompletedDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.trip_id === 'string' &&
    typeof row.route_id === 'string' &&
    typeof row.departure_time === 'string' &&
    row.status === 'completed' &&
    isStringArray(row.agency_ids)
  );
}

export function assertNoPiiInTripCompletedPayload(
  payload: Record<string, unknown>,
): boolean {
  return assertNoPiiInTripPayload(payload);
}

export function parseTripCompletedEventV1(
  row: OutboxEventRow,
): TripCompletedEventV1 {
  return parseTripEventV1(
    row,
    TRIP_COMPLETED_V1_TYPE,
    TRIP_COMPLETED_V1_VERSION,
    isTripCompletedPayloadV1,
  );
}
