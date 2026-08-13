import { describe, expect, it } from 'vitest';
import type { OutboxEventRow } from './types.js';
import {
  SUPERADMIN_DIGEST_DUE_V1_AGGREGATE,
  SUPERADMIN_DIGEST_DUE_V1_TYPE,
  SUPERADMIN_DIGEST_DUE_V1_VERSION,
  assertNoPiiInSuperadminDigestDuePayload,
  isSuperadminDigestDuePayloadV1,
  parseSuperadminDigestDueEventV1,
  superadminDigestDedupKey,
} from './superadmin-digest-due.v1.js';

const AGGREGATE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function row(
  payload: Record<string, unknown>,
  overrides: Partial<OutboxEventRow> = {},
): OutboxEventRow {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    event_type: SUPERADMIN_DIGEST_DUE_V1_TYPE,
    event_version: SUPERADMIN_DIGEST_DUE_V1_VERSION,
    aggregate_type: SUPERADMIN_DIGEST_DUE_V1_AGGREGATE,
    aggregate_id: AGGREGATE_ID,
    tenant_id: null,
    payload,
    status: 'pending',
    attempts: 0,
    available_at: '2026-08-13T11:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-13T11:00:00.000Z',
    updated_at: '2026-08-13T11:00:00.000Z',
    ...overrides,
  };
}

const basePayload = { digest_date: '2026-08-13' };

describe('F4-002 — superadmin.digest.due.v1 contract', () => {
  it('accepts type, version, platform aggregate, tenant null, payload', () => {
    const parsed = parseSuperadminDigestDueEventV1(row(basePayload));
    expect(parsed.type).toBe(SUPERADMIN_DIGEST_DUE_V1_TYPE);
    expect(parsed.version).toBe(1);
    expect(parsed.aggregate.type).toBe('platform');
    expect(parsed.tenant.agency_id).toBeNull();
    expect(parsed.data.digest_date).toBe('2026-08-13');
  });

  it('does not require payload to match aggregate_id', () => {
    expect(() => parseSuperadminDigestDueEventV1(row(basePayload))).not.toThrow();
  });

  it('rejects invalid digest_date or missing fields', () => {
    expect(
      isSuperadminDigestDuePayloadV1({ digest_date: '08-13-2026' }),
    ).toBe(false);
    expect(isSuperadminDigestDuePayloadV1({})).toBe(false);
  });

  it('rejects non-null tenant_id and wrong aggregate type', () => {
    expect(() =>
      parseSuperadminDigestDueEventV1(
        row(basePayload, { tenant_id: AGGREGATE_ID }),
      ),
    ).toThrow(/tenant_id/);
    expect(() =>
      parseSuperadminDigestDueEventV1(
        row(basePayload, { aggregate_type: 'agency' }),
      ),
    ).toThrow(/aggregate_type/);
  });

  it('rejects PII keys in payload', () => {
    expect(
      assertNoPiiInSuperadminDigestDuePayload({
        ...basePayload,
        booker_name: 'Ana',
      }),
    ).toBe(false);
    expect(() =>
      parseSuperadminDigestDueEventV1(
        row({ ...basePayload, agency_email: 'x@y.com' }),
      ),
    ).toThrow(/PII/);
  });

  it('builds daily dedup key', () => {
    expect(superadminDigestDedupKey('2026-08-13')).toBe(
      'superadmin.digest.due:2026-08-13',
    );
  });
});
