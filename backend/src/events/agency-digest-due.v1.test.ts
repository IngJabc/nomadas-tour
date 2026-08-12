import { describe, expect, it } from 'vitest';
import type { OutboxEventRow } from './types.js';
import {
  AGENCY_DIGEST_DUE_V1_AGGREGATE,
  AGENCY_DIGEST_DUE_V1_TYPE,
  AGENCY_DIGEST_DUE_V1_VERSION,
  agencyDigestDedupKey,
  assertNoPiiInAgencyDigestDuePayload,
  isAgencyDigestDuePayloadV1,
  parseAgencyDigestDueEventV1,
} from './agency-digest-due.v1.js';

const AGENCY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function row(
  payload: Record<string, unknown>,
  overrides: Partial<OutboxEventRow> = {},
): OutboxEventRow {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    event_type: AGENCY_DIGEST_DUE_V1_TYPE,
    event_version: AGENCY_DIGEST_DUE_V1_VERSION,
    aggregate_type: AGENCY_DIGEST_DUE_V1_AGGREGATE,
    aggregate_id: AGENCY_A,
    tenant_id: AGENCY_A,
    payload,
    status: 'pending',
    attempts: 0,
    available_at: '2026-08-12T11:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-12T11:00:00.000Z',
    updated_at: '2026-08-12T11:00:00.000Z',
    ...overrides,
  };
}

const basePayload = {
  agency_id: AGENCY_A,
  digest_date: '2026-08-12',
};

describe('F4-001 — agency.digest.due.v1 contract', () => {
  it('accepts minimal payload', () => {
    expect(isAgencyDigestDuePayloadV1(basePayload)).toBe(true);
  });

  it('rejects invalid digest_date or missing fields', () => {
    expect(
      isAgencyDigestDuePayloadV1({ ...basePayload, digest_date: '08-12-2026' }),
    ).toBe(false);
    expect(isAgencyDigestDuePayloadV1({ agency_id: AGENCY_A })).toBe(false);
  });

  it('parses envelope with tenant_id = agency_id', () => {
    const parsed = parseAgencyDigestDueEventV1(row(basePayload));
    expect(parsed.type).toBe(AGENCY_DIGEST_DUE_V1_TYPE);
    expect(parsed.version).toBe(1);
    expect(parsed.tenant.agency_id).toBe(AGENCY_A);
    expect(parsed.data.digest_date).toBe('2026-08-12');
  });

  it('rejects tenant_id mismatch and agency_id mismatch', () => {
    expect(() =>
      parseAgencyDigestDueEventV1(row(basePayload, { tenant_id: null })),
    ).toThrow(/tenant_id/);
    expect(() =>
      parseAgencyDigestDueEventV1(
        row({
          ...basePayload,
          agency_id: '99999999-9999-9999-9999-999999999999',
        }),
      ),
    ).toThrow(/payload.agency_id must match aggregate_id/);
  });

  it('rejects PII keys in payload', () => {
    expect(
      assertNoPiiInAgencyDigestDuePayload({
        ...basePayload,
        agency_email: 'x@y.com',
      }),
    ).toBe(false);
    expect(() =>
      parseAgencyDigestDueEventV1(
        row({ ...basePayload, booker_name: 'Ana' }),
      ),
    ).toThrow(/PII/);
  });

  it('builds daily dedup key', () => {
    expect(agencyDigestDedupKey(AGENCY_A, '2026-08-12')).toBe(
      `agency.digest.due:${AGENCY_A}:2026-08-12`,
    );
  });
});
