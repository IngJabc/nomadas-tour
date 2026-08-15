import { describe, expect, it } from 'vitest';
import {
  decodeAuditCursor,
  encodeAuditCursor,
} from '../utils/audit-cursor.js';
import { ValidationError } from '../errors/index.js';

const ID = '44444444-4444-4444-8444-444444444444';
const T = '2026-08-15T12:00:00.000Z';

describe('audit-cursor', () => {
  it('encodes base64url JSON and decodes', () => {
    const encoded = encodeAuditCursor({ t: T, i: ID });
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(decodeAuditCursor(encoded)).toEqual({ t: T, i: ID });
  });

  it('throws VALIDATION_ERROR on garbage', () => {
    try {
      decodeAuditCursor('abc');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).code).toBe('VALIDATION_ERROR');
    }
  });
});
