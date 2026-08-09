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

/** Logical identifier: trip.postponed.v1 */
export const TRIP_POSTPONED_V1_TYPE = 'trip.postponed' as const;
export const TRIP_POSTPONED_V1_VERSION = 1 as const;
export const TRIP_POSTPONED_V1_AGGREGATE = TRIP_EVENT_AGGREGATE;

/**
 * previous_departure_time = the trip.departure_time before the postpone
 * (equivalent of postponed_from). No PII — workers re-read route/agencies.
 */
export interface TripPostponedDataV1 {
  trip_id: string;
  route_id: string;
  previous_departure_time: string;
  departure_time: string;
  agency_ids: string[];
}

export type TripPostponedEventV1 = EventEnvelope<TripPostponedDataV1>;

export function isTripPostponedPayloadV1(
  value: unknown,
): value is TripPostponedDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.trip_id === 'string' &&
    typeof row.route_id === 'string' &&
    typeof row.previous_departure_time === 'string' &&
    typeof row.departure_time === 'string' &&
    isStringArray(row.agency_ids)
  );
}

export function assertNoPiiInTripPostponedPayload(
  payload: Record<string, unknown>,
): boolean {
  return assertNoPiiInTripPayload(payload);
}

export function parseTripPostponedEventV1(
  row: OutboxEventRow,
): TripPostponedEventV1 {
  return parseTripEventV1(
    row,
    TRIP_POSTPONED_V1_TYPE,
    TRIP_POSTPONED_V1_VERSION,
    isTripPostponedPayloadV1,
  );
}
