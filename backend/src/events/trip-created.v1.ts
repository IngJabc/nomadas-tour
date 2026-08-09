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

/** Logical identifier: trip.created.v1 */
export const TRIP_CREATED_V1_TYPE = 'trip.created' as const;
export const TRIP_CREATED_V1_VERSION = 1 as const;
export const TRIP_CREATED_V1_AGGREGATE = TRIP_EVENT_AGGREGATE;

/**
 * Minimal payload — no agency names/emails, no user data.
 * Workers re-read route origin/destination and agency details by id.
 */
export interface TripCreatedDataV1 {
  trip_id: string;
  route_id: string;
  departure_time: string;
  vehicle_type: string;
  capacity: number;
  agency_ids: string[];
}

export type TripCreatedEventV1 = EventEnvelope<TripCreatedDataV1>;

export function isTripCreatedPayloadV1(
  value: unknown,
): value is TripCreatedDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.trip_id === 'string' &&
    typeof row.route_id === 'string' &&
    typeof row.departure_time === 'string' &&
    typeof row.vehicle_type === 'string' &&
    typeof row.capacity === 'number' &&
    Number.isInteger(row.capacity) &&
    row.capacity > 0 &&
    isStringArray(row.agency_ids)
  );
}

export function assertNoPiiInTripCreatedPayload(
  payload: Record<string, unknown>,
): boolean {
  return assertNoPiiInTripPayload(payload);
}

export function parseTripCreatedEventV1(
  row: OutboxEventRow,
): TripCreatedEventV1 {
  return parseTripEventV1(
    row,
    TRIP_CREATED_V1_TYPE,
    TRIP_CREATED_V1_VERSION,
    isTripCreatedPayloadV1,
  );
}
