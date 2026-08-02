/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  findForbiddenUserMetadataInSource,
  USER_METADATA_ALLOWLIST,
} from './helpers/scan-source.js';

describe('SEC-007 — no user_metadata in executable source', () => {
  it('allowlists auth.service.ts until accept-invitation cleanup', () => {
    expect(USER_METADATA_ALLOWLIST.has('backend/src/services/auth.service.ts')).toBe(true);
  });

  it('finds no user_metadata in app/, components/, hooks/, lib/, middleware.ts, backend/src/', () => {
    const hits = findForbiddenUserMetadataInSource();

    expect(hits).toEqual([]);
  });
});
