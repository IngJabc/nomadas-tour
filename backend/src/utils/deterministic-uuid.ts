import { createHash } from 'node:crypto';

/**
 * F4-002 R1 — deterministic platform aggregate_id.
 *
 * Final resolution (post-implementation audit):
 * - RFC 4122 UUIDv5
 * - SHA-1 via node:crypto (`createHash('sha1')`)
 * - constant namespace {@link NOMADAS_PLATFORM_NAMESPACE_NAME}
 * - computed exclusively in TypeScript
 * - no PostgreSQL extension
 * - not MD5
 *
 * Do not add a second implementation in SQL.
 */

/**
 * RFC 4122 Appendix C — DNS namespace UUID.
 * Used only to derive {@link NOMADAS_PLATFORM_NAMESPACE}.
 */
export const RFC4122_NAMESPACE_DNS =
  '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Stable name for the Nomadas platform namespace.
 * Do not rename — F4-002 aggregate IDs are derived from this string.
 */
export const NOMADAS_PLATFORM_NAMESPACE_NAME = 'nomadas-platform';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidToBytes(uuid: string): Buffer {
  if (!UUID_RE.test(uuid)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * RFC 4122 UUID version 5 (SHA-1 name-based) via node:crypto.
 * No PostgreSQL extensions.
 */
export function uuidV5(name: string, namespaceUuid: string): string {
  const hash = createHash('sha1');
  hash.update(uuidToBytes(namespaceUuid));
  hash.update(name, 'utf8');
  const digest = hash.digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

/**
 * Documented platform namespace: UUIDv5("nomadas-platform", DNS).
 * Stable. Changing this value would rewrite historical aggregate IDs.
 */
export const NOMADAS_PLATFORM_NAMESPACE = uuidV5(
  NOMADAS_PLATFORM_NAMESPACE_NAME,
  RFC4122_NAMESPACE_DNS,
);

const DIGEST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Deterministic aggregate_id for F4-002.
 * Input = platform namespace name + digest_date (YYYY-MM-DD Caracas).
 * Same digest_date always yields the same UUID.
 */
export function platformDigestAggregateId(digestDate: string): string {
  if (!DIGEST_DATE_RE.test(digestDate)) {
    throw new Error(`Invalid digestDate: ${digestDate}`);
  }
  return uuidV5(digestDate, NOMADAS_PLATFORM_NAMESPACE);
}
