import {
  type EventEnvelope,
  type OutboxEventRow,
  envelopeFromOutboxRow,
} from './types.js';
import { assertNoPiiInTripPayload } from './trip-common.js';

/** Logical identifier: agency.digest.due.v1 */
export const AGENCY_DIGEST_DUE_V1_TYPE = 'agency.digest.due' as const;
export const AGENCY_DIGEST_DUE_V1_VERSION = 1 as const;
export const AGENCY_DIGEST_DUE_V1_AGGREGATE = 'agency' as const;

/**
 * Minimal payload — no agency name/email, no passenger PII.
 * Handler re-reads aggregates by agency_id.
 */
export interface AgencyDigestDueDataV1 {
  agency_id: string;
  digest_date: string;
}

export type AgencyDigestDueEventV1 = EventEnvelope<AgencyDigestDueDataV1>;

const DIGEST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isAgencyDigestDuePayloadV1(
  value: unknown,
): value is AgencyDigestDueDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.agency_id === 'string' &&
    typeof row.digest_date === 'string' &&
    DIGEST_DATE_RE.test(row.digest_date)
  );
}

export function assertNoPiiInAgencyDigestDuePayload(
  payload: Record<string, unknown>,
): boolean {
  return assertNoPiiInTripPayload(payload);
}

export function agencyDigestDedupKey(
  agencyId: string,
  digestDate: string,
): string {
  return `agency.digest.due:${agencyId}:${digestDate}`;
}

export function parseAgencyDigestDueEventV1(
  row: OutboxEventRow,
): AgencyDigestDueEventV1 {
  if (row.event_type !== AGENCY_DIGEST_DUE_V1_TYPE) {
    throw new Error(
      `Expected event_type ${AGENCY_DIGEST_DUE_V1_TYPE}, got ${row.event_type}`,
    );
  }
  if (row.event_version !== AGENCY_DIGEST_DUE_V1_VERSION) {
    throw new Error(
      `Expected event_version ${AGENCY_DIGEST_DUE_V1_VERSION}, got ${row.event_version}`,
    );
  }
  if (row.aggregate_type !== AGENCY_DIGEST_DUE_V1_AGGREGATE) {
    throw new Error(
      `Expected aggregate_type ${AGENCY_DIGEST_DUE_V1_AGGREGATE}, got ${row.aggregate_type}`,
    );
  }
  if (row.tenant_id == null || row.tenant_id !== row.aggregate_id) {
    throw new Error(
      `Expected tenant_id = aggregate_id for ${AGENCY_DIGEST_DUE_V1_TYPE}.v${AGENCY_DIGEST_DUE_V1_VERSION}`,
    );
  }
  if (!isAgencyDigestDuePayloadV1(row.payload)) {
    throw new Error(
      `Invalid ${AGENCY_DIGEST_DUE_V1_TYPE}.v${AGENCY_DIGEST_DUE_V1_VERSION} payload shape`,
    );
  }
  if (!assertNoPiiInAgencyDigestDuePayload(row.payload)) {
    throw new Error(
      `${AGENCY_DIGEST_DUE_V1_TYPE}.v${AGENCY_DIGEST_DUE_V1_VERSION} payload must not contain PII keys`,
    );
  }
  if (row.payload.agency_id !== row.aggregate_id) {
    throw new Error('payload.agency_id must match aggregate_id');
  }

  return envelopeFromOutboxRow(row, row.payload);
}
