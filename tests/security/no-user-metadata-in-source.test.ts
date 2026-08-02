/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { findForbiddenUserMetadataInSource } from './helpers/scan-source.js';

describe('SEC-008 — no user_metadata in executable source', () => {
  it('finds no user_metadata or raw_user_meta_data in app/, components/, hooks/, lib/, middleware.ts, backend/src/', () => {
    const hits = findForbiddenUserMetadataInSource();

    expect(hits).toEqual([]);
  });
});
