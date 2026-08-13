import { describe, expect, it } from 'vitest';
import {
  NOMADAS_PLATFORM_NAMESPACE,
  NOMADAS_PLATFORM_NAMESPACE_NAME,
  RFC4122_NAMESPACE_DNS,
  platformDigestAggregateId,
  uuidV5,
} from './deterministic-uuid.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('F4-002 — deterministic UUID', () => {
  it('matches RFC 4122 v5 example for www.example.com', () => {
    expect(uuidV5('www.example.com', RFC4122_NAMESPACE_DNS)).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('derives a stable platform namespace from nomadas-platform', () => {
    expect(NOMADAS_PLATFORM_NAMESPACE_NAME).toBe('nomadas-platform');
    expect(NOMADAS_PLATFORM_NAMESPACE).toBe(
      uuidV5(NOMADAS_PLATFORM_NAMESPACE_NAME, RFC4122_NAMESPACE_DNS),
    );
    expect(NOMADAS_PLATFORM_NAMESPACE).toMatch(UUID_RE);
  });

  it('same digest_date produces the same UUID', () => {
    const a = platformDigestAggregateId('2026-08-13');
    const b = platformDigestAggregateId('2026-08-13');
    expect(a).toBe(b);
    expect(a).toMatch(UUID_RE);
  });

  it('different digest_dates produce different UUIDs', () => {
    const a = platformDigestAggregateId('2026-08-13');
    const b = platformDigestAggregateId('2026-08-14');
    expect(a).not.toBe(b);
    expect(b).toMatch(UUID_RE);
  });

  it('rejects invalid digest_date', () => {
    expect(() => platformDigestAggregateId('08-13-2026')).toThrow(
      /Invalid digestDate/,
    );
  });

  it('keeps R1 as UUIDv5/SHA-1 (version nibble 5), not MD5', () => {
    const id = platformDigestAggregateId('2026-08-13');
    expect(id.charAt(14)).toBe('5');
    expect(uuidV5('www.example.com', RFC4122_NAMESPACE_DNS)).not.toBe(
      // RFC 4122 v3 (MD5) of the same name would differ.
      '9073926b-929f-31c2-abc9-fad77ae3e8eb',
    );
  });
});
