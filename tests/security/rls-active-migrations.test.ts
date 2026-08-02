/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTIVE_RLS_MIGRATION,
  scanActiveRlsMigration,
} from './helpers/scan-sql-policies.js';

describe('SEC-007 — active RLS migration (039 only)', () => {
  it('scans only 039_rls_identity_from_public_users_v2.sql', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../..');
    expect(fs.existsSync(path.join(repoRoot, ACTIVE_RLS_MIGRATION))).toBe(true);
  });

  it('CREATE POLICY blocks must not reference user_metadata', () => {
    const result = scanActiveRlsMigration();

    expect(result.policyCount).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
  });

  it('authorization policies use private.auth_app_role()', () => {
    const result = scanActiveRlsMigration();

    expect(result.missingRoleHelper).toEqual([]);
  });

  it('agency-scoped policies use private.auth_app_agency_id()', () => {
    const result = scanActiveRlsMigration();

    expect(result.agencyPoliciesMissingAgencyHelper).toEqual([]);
  });
});
