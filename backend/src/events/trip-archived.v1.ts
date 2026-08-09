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

/** Logical identifier: trip.archived.v1 (resolves the catalog gap) */
export const TRIP_ARCHIVED_V1_TYPE = 'trip.archived' as const;
export const TRIP_ARCHIVED_V1_VERSION = 1 as const;
export const TRIP_ARCHIVED_V1_AGGREGATE = TRIP_EVENT_AGGREGATE;

export interface TripArchivedDataV1 {
  trip_id: string;
  route_id: string;
  departure_time: string;
  status: 'archived';
  agency_ids: string[];
}

export type TripArchivedEventV1 = EventEnvelope<TripArchivedDataV1>;

export function isTripArchivedPayloadV1(
  value: unknown,
): value is TripArchivedDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.trip_id === 'string' &&
    typeof row.route_id === 'string' &&
    typeof row.departure_time === 'string' &&
    row.status === 'archived' &&
    isStringArray(row.agency_ids)
  );
}

export function assertNoPiiInTripArchivedPayload(
  payload: Record<string, unknown>,
): boolean {
  return assertNoPiiInTripPayload(payload);
}

export function parseTripArchivedEventV1(
  row: OutboxEventRow,
): TripArchivedEventV1 {
  return parseTripEventV1(
    row,
    TRIP_ARCHIVED_V1_TYPE,
    TRIP_ARCHIVED_V1_VERSION,
    isTripArchivedPayloadV1,
  );
}
