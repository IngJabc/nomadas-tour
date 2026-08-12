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

/** Logical identifier: trip.reminder_due.v1 */
export const TRIP_REMINDER_DUE_V1_TYPE = 'trip.reminder_due' as const;
export const TRIP_REMINDER_DUE_V1_VERSION = 1 as const;
export const TRIP_REMINDER_DUE_V1_AGGREGATE = TRIP_EVENT_AGGREGATE;

export type TripReminderWindow = 't48' | 't24';

/**
 * Minimal payload — no booker/agency PII.
 * Workers re-read route and reservation contact emails by id.
 */
export interface TripReminderDueDataV1 {
  trip_id: string;
  route_id: string;
  departure_time: string;
  window: TripReminderWindow;
  agency_ids: string[];
}

export type TripReminderDueEventV1 = EventEnvelope<TripReminderDueDataV1>;

export function isTripReminderWindow(
  value: unknown,
): value is TripReminderWindow {
  return value === 't48' || value === 't24';
}

export function isTripReminderDuePayloadV1(
  value: unknown,
): value is TripReminderDueDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.trip_id === 'string' &&
    typeof row.route_id === 'string' &&
    typeof row.departure_time === 'string' &&
    isTripReminderWindow(row.window) &&
    isStringArray(row.agency_ids)
  );
}

export function assertNoPiiInTripReminderDuePayload(
  payload: Record<string, unknown>,
): boolean {
  return assertNoPiiInTripPayload(payload);
}

export function parseTripReminderDueEventV1(
  row: OutboxEventRow,
): TripReminderDueEventV1 {
  return parseTripEventV1(
    row,
    TRIP_REMINDER_DUE_V1_TYPE,
    TRIP_REMINDER_DUE_V1_VERSION,
    isTripReminderDuePayloadV1,
  );
}
