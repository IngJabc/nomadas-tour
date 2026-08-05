import {
  envelopeFromOutboxRow,
  type EventEnvelope,
  type OutboxEventRow,
} from './types.js';

/** Logical identifier: reservation.created.v1 */
export const RESERVATION_CREATED_V1_TYPE = 'reservation.created' as const;
export const RESERVATION_CREATED_V1_VERSION = 1 as const;
export const RESERVATION_CREATED_V1_AGGREGATE = 'reservation' as const;

/**
 * Minimal payload — no passengers, documents, phones, emails, or QR.
 * Workers re-read reservation details by reservation_id as needed.
 */
export interface ReservationCreatedDataV1 {
  reservation_id: string;
  trip_id: string;
  agency_id: string;
}

export type ReservationCreatedEventV1 = EventEnvelope<ReservationCreatedDataV1>;

const PII_PAYLOAD_KEYS = [
  'document',
  'phone',
  'email',
  'contact_email',
  'qr',
  'qr_code',
  'booker_document',
  'booker_phone',
  'booker_name',
  'passengers',
] as const;

export function isReservationCreatedPayloadV1(
  value: unknown,
): value is ReservationCreatedDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.reservation_id === 'string' &&
    typeof row.trip_id === 'string' &&
    typeof row.agency_id === 'string'
  );
}

export function assertNoPiiInReservationCreatedPayload(
  payload: Record<string, unknown>,
): boolean {
  for (const key of PII_PAYLOAD_KEYS) {
    if (key in payload) return false;
  }
  return true;
}

export function parseReservationCreatedEventV1(
  row: OutboxEventRow,
): ReservationCreatedEventV1 {
  if (row.event_type !== RESERVATION_CREATED_V1_TYPE) {
    throw new Error(
      `Expected event_type ${RESERVATION_CREATED_V1_TYPE}, got ${row.event_type}`,
    );
  }
  if (row.event_version !== RESERVATION_CREATED_V1_VERSION) {
    throw new Error(
      `Expected event_version ${RESERVATION_CREATED_V1_VERSION}, got ${row.event_version}`,
    );
  }
  if (row.aggregate_type !== RESERVATION_CREATED_V1_AGGREGATE) {
    throw new Error(
      `Expected aggregate_type ${RESERVATION_CREATED_V1_AGGREGATE}, got ${row.aggregate_type}`,
    );
  }
  if (!isReservationCreatedPayloadV1(row.payload)) {
    throw new Error('Invalid reservation.created.v1 payload shape');
  }
  if (!assertNoPiiInReservationCreatedPayload(row.payload)) {
    throw new Error('reservation.created.v1 payload must not contain PII keys');
  }
  if (row.payload.reservation_id !== row.aggregate_id) {
    throw new Error('payload.reservation_id must match aggregate_id');
  }

  return envelopeFromOutboxRow(row, row.payload);
}
