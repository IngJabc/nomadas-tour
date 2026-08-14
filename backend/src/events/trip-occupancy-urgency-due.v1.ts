import {
  type EventEnvelope,
  type OutboxEventRow,
} from './types.js';
import {
  TRIP_EVENT_AGGREGATE,
  assertNoPiiInTripPayload,
  parseTripEventV1,
} from './trip-common.js';
import {
  isOccupancyAlertType,
  type OccupancyAlertType,
} from './trip-occupancy-alert-due.v1.js';

/** Logical identifier: trip.occupancy_urgency.due.v1 */
export const TRIP_OCCUPANCY_URGENCY_DUE_V1_TYPE =
  'trip.occupancy_urgency.due' as const;
export const TRIP_OCCUPANCY_URGENCY_DUE_V1_VERSION = 1 as const;
export const TRIP_OCCUPANCY_URGENCY_DUE_V1_AGGREGATE = TRIP_EVENT_AGGREGATE;

/** Versioned T-24h window constant (not an env var). */
export const OCCUPANCY_URGENCY_WINDOW = 't24' as const;
export type OccupancyUrgencyWindow = typeof OCCUPANCY_URGENCY_WINDOW;

/** 24h in ms — shared constant for widget / service derivation. */
export const OCCUPANCY_URGENCY_WINDOW_MS = 86_400_000;

/**
 * Minimal payload — no PII, no agency_ids, no transition token.
 * Handler re-reads trip_agencies and route by id.
 */
export interface TripOccupancyUrgencyDueDataV1 {
  trip_id: string;
  alert_type: OccupancyAlertType;
  occupancy_pct: number;
  departure_time: string;
  route_id: string;
  urgency_window: OccupancyUrgencyWindow;
}

export type TripOccupancyUrgencyDueEventV1 =
  EventEnvelope<TripOccupancyUrgencyDueDataV1>;

export function isOccupancyUrgencyWindow(
  value: unknown,
): value is OccupancyUrgencyWindow {
  return value === OCCUPANCY_URGENCY_WINDOW;
}

export function isTripOccupancyUrgencyDuePayloadV1(
  value: unknown,
): value is TripOccupancyUrgencyDueDataV1 {
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
    isOccupancyUrgencyWindow(row.urgency_window) &&
    !('transition' in row)
  );
}

export function assertNoPiiInTripOccupancyUrgencyDuePayload(
  payload: Record<string, unknown>,
): boolean {
  return assertNoPiiInTripPayload(payload);
}

/**
 * Cycle identity includes departure so postponement opens a new urgency cycle.
 * Format: trip.occupancy_urgency:{tripId}:{alertType}:{window}:{departureUtc}
 */
export function urgencyDedupKey(
  tripId: string,
  alertType: OccupancyAlertType,
  window: OccupancyUrgencyWindow,
  departureUtcCanonical: string,
): string {
  return `trip.occupancy_urgency:${tripId}:${alertType}:${window}:${departureUtcCanonical}`;
}

export function parseTripOccupancyUrgencyDueEventV1(
  row: OutboxEventRow,
): TripOccupancyUrgencyDueEventV1 {
  return parseTripEventV1(
    row,
    TRIP_OCCUPANCY_URGENCY_DUE_V1_TYPE,
    TRIP_OCCUPANCY_URGENCY_DUE_V1_VERSION,
    isTripOccupancyUrgencyDuePayloadV1,
  );
}
