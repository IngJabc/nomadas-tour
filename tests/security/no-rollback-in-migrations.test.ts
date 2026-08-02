/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  findRollbackFilesInMigrations,
  findMetadataRlsInPost039Migrations,
  listPost039MigrationFiles,
} from './helpers/scan-migrations.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

describe('SEC-C1 — migrations must not auto-apply metadata RLS rollback', () => {
  it('has no rollback/revert SQL files under supabase/migrations/', () => {
    expect(findRollbackFilesInMigrations()).toEqual([]);
  });

  it('post-039 migrations (039+, 040+) have no user_metadata in CREATE POLICY', () => {
    const files = listPost039MigrationFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('039_rls_identity_from_public_users_v2.sql');
    expect(files).not.toContain('039_rollback_restore_metadata_rls.sql');

    expect(findMetadataRlsInPost039Migrations()).toEqual([]);
  });

  it('manual rollback lives outside migrations/', () => {
    const rollbackPath = path.join(
      REPO_ROOT,
      'supabase/rollbacks/039_rollback_restore_metadata_rls.sql',
    );
    expect(fs.existsSync(rollbackPath)).toBe(true);
  });
});
