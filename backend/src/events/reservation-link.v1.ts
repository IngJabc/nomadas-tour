import {
  envelopeFromOutboxRow,
  type EventEnvelope,
  type OutboxEventRow,
} from './types.js';

export const RESERVATION_LINK_AGGREGATE = 'reservation_link' as const;
export const RESERVATION_LINK_EVENT_VERSION = 1 as const;

export const RESERVATION_LINK_CREATED_V1_TYPE = 'reservation_link.created' as const;
export const RESERVATION_LINK_SAVED_V1_TYPE =
  'reservation_link.passenger_data_saved' as const;
export const RESERVATION_LINK_CONFIRMED_V1_TYPE =
  'reservation_link.confirmed' as const;
export const RESERVATION_LINK_CANCELLED_V1_TYPE =
  'reservation_link.cancelled' as const;

export interface ReservationLinkBaseDataV1 {
  link_id: string;
  trip_id: string;
  agency_id: string;
}

export interface ReservationLinkConfirmedDataV1 extends ReservationLinkBaseDataV1 {
  reservation_id: string;
}

function isBase(value: unknown): value is ReservationLinkBaseDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.link_id === 'string' &&
    typeof row.trip_id === 'string' &&
    typeof row.agency_id === 'string'
  );
}

function parseBase(
  row: OutboxEventRow,
  expectedType: string,
): EventEnvelope<ReservationLinkBaseDataV1> {
  if (row.event_type !== expectedType) {
    throw new Error(`Expected event_type ${expectedType}, got ${row.event_type}`);
  }
  if (row.event_version !== RESERVATION_LINK_EVENT_VERSION) {
    throw new Error(`Expected event_version ${RESERVATION_LINK_EVENT_VERSION}`);
  }
  if (row.aggregate_type !== RESERVATION_LINK_AGGREGATE) {
    throw new Error(`Expected aggregate_type ${RESERVATION_LINK_AGGREGATE}`);
  }
  if (!isBase(row.payload)) {
    throw new Error(`Invalid ${expectedType} payload`);
  }
  if (row.payload.link_id !== row.aggregate_id) {
    throw new Error('payload.link_id must match aggregate_id');
  }
  return envelopeFromOutboxRow(row, row.payload);
}

export function parseReservationLinkCreatedEventV1(row: OutboxEventRow) {
  return parseBase(row, RESERVATION_LINK_CREATED_V1_TYPE);
}

export function parseReservationLinkSavedEventV1(row: OutboxEventRow) {
  return parseBase(row, RESERVATION_LINK_SAVED_V1_TYPE);
}

export function parseReservationLinkCancelledEventV1(row: OutboxEventRow) {
  return parseBase(row, RESERVATION_LINK_CANCELLED_V1_TYPE);
}

export function parseReservationLinkConfirmedEventV1(
  row: OutboxEventRow,
): EventEnvelope<ReservationLinkConfirmedDataV1> {
  const base = parseBase(row, RESERVATION_LINK_CONFIRMED_V1_TYPE);
  const reservationId = (row.payload as { reservation_id?: unknown }).reservation_id;
  if (typeof reservationId !== 'string') {
    throw new Error('Invalid reservation_link.confirmed payload');
  }
  return envelopeFromOutboxRow(row, { ...base.data, reservation_id: reservationId });
}
