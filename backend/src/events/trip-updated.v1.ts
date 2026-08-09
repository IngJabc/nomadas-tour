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

/** Logical identifier: trip.updated.v1 (non-postpone edit, no consumer in WKR-007) */
export const TRIP_UPDATED_V1_TYPE = 'trip.updated' as const;
export const TRIP_UPDATED_V1_VERSION = 1 as const;
export const TRIP_UPDATED_V1_AGGREGATE = TRIP_EVENT_AGGREGATE;

/**
 * changed_fields lists the trip fields modified by the edit. Emitted by the
 * update_trip RPC only when the change is neither a postpone nor a status
 * transition. No consumer in WKR-007 (observability / future audit only).
 */
export interface TripUpdatedDataV1 {
  trip_id: string;
  route_id: string;
  departure_time: string;
  changed_fields: string[];
  agency_ids: string[];
}

export type TripUpdatedEventV1 = EventEnvelope<TripUpdatedDataV1>;

export function isTripUpdatedPayloadV1(
  value: unknown,
): value is TripUpdatedDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.trip_id === 'string' &&
    typeof row.route_id === 'string' &&
    typeof row.departure_time === 'string' &&
    isStringArray(row.changed_fields) &&
    isStringArray(row.agency_ids)
  );
}

export function assertNoPiiInTripUpdatedPayload(
  payload: Record<string, unknown>,
): boolean {
  return assertNoPiiInTripPayload(payload);
}

export function parseTripUpdatedEventV1(
  row: OutboxEventRow,
): TripUpdatedEventV1 {
  return parseTripEventV1(
    row,
    TRIP_UPDATED_V1_TYPE,
    TRIP_UPDATED_V1_VERSION,
    isTripUpdatedPayloadV1,
  );
}
