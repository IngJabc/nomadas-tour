import { ValidationError } from '../errors/index.js';
import type { AuditCursor } from '../types/audit.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isIsoDatetime(value: string): boolean {
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

/**
 * Encode opaque keyset cursor: base64url(JSON.stringify({ t, i })).
 * Do not expose this shape in API docs as a public contract.
 */
export function encodeAuditCursor(cursor: AuditCursor): string {
  const json = JSON.stringify({ t: cursor.t, i: cursor.i });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode opaque keyset cursor. Invalid → ValidationError (400).
 */
export function decodeAuditCursor(raw: string): AuditCursor {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof (parsed as AuditCursor).t !== 'string' ||
      typeof (parsed as AuditCursor).i !== 'string'
    ) {
      throw new ValidationError('Invalid input', [
        { path: ['cursor'], message: 'Invalid cursor' },
      ]);
    }
    const { t, i } = parsed as AuditCursor;
    if (!isIsoDatetime(t) || !UUID_RE.test(i)) {
      throw new ValidationError('Invalid input', [
        { path: ['cursor'], message: 'Invalid cursor' },
      ]);
    }
    return { t, i };
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError('Invalid input', [
      { path: ['cursor'], message: 'Invalid cursor' },
    ]);
  }
}

/** Quote a PostgREST filter value that may contain `:` (ISO timestamps). */
export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
