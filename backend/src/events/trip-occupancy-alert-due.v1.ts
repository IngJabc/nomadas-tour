import {
  type EventEnvelope,
  type OutboxEventRow,
} from './types.js';
import {
  TRIP_EVENT_AGGREGATE,
  assertNoPiiInTripPayload,
  parseTripEventV1,
} from './trip-common.js';

/** Logical identifier: trip.occupancy_alert.due.v1 */
export const TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE =
  'trip.occupancy_alert.due' as const;
export const TRIP_OCCUPANCY_ALERT_DUE_V1_VERSION = 1 as const;
export const TRIP_OCCUPANCY_ALERT_DUE_V1_AGGREGATE = TRIP_EVENT_AGGREGATE;

export type OccupancyAlertType = 'near_full' | 'underbooked';

/**
 * Minimal payload — no PII, no agency_ids, no transition token.
 * Handler re-reads trip_agencies and route by id.
 */
export interface TripOccupancyAlertDueDataV1 {
  trip_id: string;
  alert_type: OccupancyAlertType;
  occupancy_pct: number;
  departure_time: string;
  route_id: string;
}

export type TripOccupancyAlertDueEventV1 =
  EventEnvelope<TripOccupancyAlertDueDataV1>;

export function isOccupancyAlertType(
  value: unknown,
): value is OccupancyAlertType {
  return value === 'near_full' || value === 'underbooked';
}

export function isTripOccupancyAlertDuePayloadV1(
  value: unknown,
): value is TripOccupancyAlertDueDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.trip_id === 'string' &&
    isOccupancyAlertType(row.alert_type) &&
    typeof row.occupancy_pct === 'number' &&
    Number.isFinite(row.occupancy_pct) &&
    row.occupancy_pct >= 0 &&
    row.occupancy_pct <= 100 &&
    typeof row.departure_time === 'string' &&
    typeof row.route_id === 'string' &&
    !('transition' in row)
  );
}

export function assertNoPiiInTripOccupancyAlertDuePayload(
  payload: Record<string, unknown>,
): boolean {
  return assertNoPiiInTripPayload(payload);
}

export function occupancyAlertDedupKey(
  tripId: string,
  alertType: OccupancyAlertType,
  updatedAt: string,
): string {
  return `trip.occupancy_alert:${tripId}:${alertType}:${updatedAt}`;
}

export function parseTripOccupancyAlertDueEventV1(
  row: OutboxEventRow,
): TripOccupancyAlertDueEventV1 {
  return parseTripEventV1(
    row,
    TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE,
    TRIP_OCCUPANCY_ALERT_DUE_V1_VERSION,
    isTripOccupancyAlertDuePayloadV1,
  );
}
