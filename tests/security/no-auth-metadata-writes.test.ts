/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { findForbiddenAuthMetadataWrites } from './helpers/scan-source.js';

describe('SEC-008 — no Auth metadata writes for role/agency_id', () => {
  it('finds no updateUser/createUser/user_metadata writes in executable source', () => {
    const hits = findForbiddenAuthMetadataWrites();

    expect(hits).toEqual([]);
  });
});
