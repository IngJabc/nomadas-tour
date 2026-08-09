import {
  envelopeFromOutboxRow,
  type EventEnvelope,
  type OutboxEventRow,
} from './types.js';

/**
 * Shared helpers for the trip.* event family (WKR-007 Fase 2).
 * Contract rules (design §5 / §10):
 * - aggregate_type is always 'trip'
 * - tenant_id is always NULL (multi-agency facts); agency_ids live in payload
 * - payloads are minimal and never contain PII (agency names/emails, users)
 */

export const TRIP_EVENT_AGGREGATE = 'trip' as const;

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
  'agency_name',
  'agency_names',
  'agency_email',
  'agency_emails',
  'user_name',
  'user_email',
  'created_by_name',
  'operator_name',
] as const;

export function assertNoPiiInTripPayload(
  payload: Record<string, unknown>,
): boolean {
  for (const key of PII_PAYLOAD_KEYS) {
    if (key in payload) return false;
  }
  return true;
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

export function parseTripEventV1<TData>(
  row: OutboxEventRow,
  expectedType: string,
  expectedVersion: number,
  isPayload: (value: unknown) => value is TData,
): EventEnvelope<TData> {
  if (row.event_type !== expectedType) {
    throw new Error(`Expected event_type ${expectedType}, got ${row.event_type}`);
  }
  if (row.event_version !== expectedVersion) {
    throw new Error(
      `Expected event_version ${expectedVersion}, got ${row.event_version}`,
    );
  }
  if (row.aggregate_type !== TRIP_EVENT_AGGREGATE) {
    throw new Error(
      `Expected aggregate_type ${TRIP_EVENT_AGGREGATE}, got ${row.aggregate_type}`,
    );
  }
  if (row.tenant_id !== null) {
    throw new Error(
      `Expected tenant_id NULL for ${expectedType}.v${expectedVersion} (multi-agency fact), got ${row.tenant_id}`,
    );
  }
  if (!isPayload(row.payload)) {
    throw new Error(`Invalid ${expectedType}.v${expectedVersion} payload shape`);
  }
  if (!assertNoPiiInTripPayload(row.payload)) {
    throw new Error(`${expectedType}.v${expectedVersion} payload must not contain PII keys`);
  }

  const payloadRecord = row.payload as Record<string, unknown>;
  if (payloadRecord.trip_id !== row.aggregate_id) {
    throw new Error('payload.trip_id must match aggregate_id');
  }

  return envelopeFromOutboxRow(row, row.payload);
}
