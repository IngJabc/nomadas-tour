import {
  type EventEnvelope,
  type OutboxEventRow,
  envelopeFromOutboxRow,
} from './types.js';
import { assertNoPiiInTripPayload } from './trip-common.js';

/** Logical identifier: superadmin.digest.due.v1 */
export const SUPERADMIN_DIGEST_DUE_V1_TYPE = 'superadmin.digest.due' as const;
export const SUPERADMIN_DIGEST_DUE_V1_VERSION = 1 as const;
export const SUPERADMIN_DIGEST_DUE_V1_AGGREGATE = 'platform' as const;

/**
 * Minimal platform payload — digest_date only.
 * No emails, names, or passenger PII.
 * aggregate_id is a synthetic deterministic UUID; do not compare to payload.
 */
export interface SuperadminDigestDueDataV1 {
  digest_date: string;
}

export type SuperadminDigestDueEventV1 =
  EventEnvelope<SuperadminDigestDueDataV1>;

const DIGEST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isSuperadminDigestDuePayloadV1(
  value: unknown,
): value is SuperadminDigestDueDataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.digest_date === 'string' && DIGEST_DATE_RE.test(row.digest_date)
  );
}

export function assertNoPiiInSuperadminDigestDuePayload(
  payload: Record<string, unknown>,
): boolean {
  return assertNoPiiInTripPayload(payload);
}

export function superadminDigestDedupKey(digestDate: string): string {
  return `superadmin.digest.due:${digestDate}`;
}

export function parseSuperadminDigestDueEventV1(
  row: OutboxEventRow,
): SuperadminDigestDueEventV1 {
  if (row.event_type !== SUPERADMIN_DIGEST_DUE_V1_TYPE) {
    throw new Error(
      `Expected event_type ${SUPERADMIN_DIGEST_DUE_V1_TYPE}, got ${row.event_type}`,
    );
  }
  if (row.event_version !== SUPERADMIN_DIGEST_DUE_V1_VERSION) {
    throw new Error(
      `Expected event_version ${SUPERADMIN_DIGEST_DUE_V1_VERSION}, got ${row.event_version}`,
    );
  }
  if (row.aggregate_type !== SUPERADMIN_DIGEST_DUE_V1_AGGREGATE) {
    throw new Error(
      `Expected aggregate_type ${SUPERADMIN_DIGEST_DUE_V1_AGGREGATE}, got ${row.aggregate_type}`,
    );
  }
  if (row.tenant_id !== null) {
    throw new Error(
      `Expected tenant_id NULL for ${SUPERADMIN_DIGEST_DUE_V1_TYPE}.v${SUPERADMIN_DIGEST_DUE_V1_VERSION}`,
    );
  }
  if (!isSuperadminDigestDuePayloadV1(row.payload)) {
    throw new Error(
      `Invalid ${SUPERADMIN_DIGEST_DUE_V1_TYPE}.v${SUPERADMIN_DIGEST_DUE_V1_VERSION} payload shape`,
    );
  }
  if (!assertNoPiiInSuperadminDigestDuePayload(row.payload)) {
    throw new Error(
      `${SUPERADMIN_DIGEST_DUE_V1_TYPE}.v${SUPERADMIN_DIGEST_DUE_V1_VERSION} payload must not contain PII keys`,
    );
  }

  return envelopeFromOutboxRow(row, row.payload);
}
