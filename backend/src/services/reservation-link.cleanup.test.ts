import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('F5-004 lock cleanup predicate', () => {
  it('uses lock_expires_at only (never locked_at + TTL)', () => {
    const files = [
      'src/index.ts',
      'src/services/reservation.service.ts',
      '../supabase/functions/release-expired-locks/index.ts',
    ];
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src, rel).toContain('lock_expires_at');
      expect(src, rel).not.toMatch(/locked_at\s*\+\s*(LOCK_TTL|INTERVAL)/);
    }
  });
});
