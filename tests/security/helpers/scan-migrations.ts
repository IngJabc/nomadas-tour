import fs from 'node:fs';
import path from 'node:path';
import {
  extractCreatePolicyBlocks,
  type RlsPolicyScanResult,
} from './scan-sql-policies.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

const MIGRATIONS_DIR = 'supabase/migrations';

const FORBIDDEN_IN_POLICIES = [
  /auth\.jwt\(\)\s*->\s*'user_metadata'/,
  /'user_metadata'\s*->>\s*'role'/,
  /'user_metadata'\s*->>\s*'agency_id'/,
];

/** Migrations at or after 039 (current RLS era). Excludes manual rollbacks folder. */
export function listPost039MigrationFiles(): string[] {
  const absDir = path.join(REPO_ROOT, MIGRATIONS_DIR);
  return fs
    .readdirSync(absDir)
    .filter((name) => name.endsWith('.sql') && name >= '039_')
    .sort();
}

export function scanMigrationFile(relativePath: string): RlsPolicyScanResult {
  const absPath = path.join(REPO_ROOT, relativePath);
  const sql = fs.readFileSync(absPath, 'utf8');
  const policies = extractCreatePolicyBlocks(sql);

  const violations: string[] = [];
  const missingRoleHelper: string[] = [];
  const agencyPoliciesMissingAgencyHelper: string[] = [];

  for (const policy of policies) {
    for (const pattern of FORBIDDEN_IN_POLICIES) {
      if (pattern.test(policy.body)) {
        violations.push(`Policy "${policy.name}" matches forbidden pattern ${pattern}`);
      }
    }
  }

  return {
    policyCount: policies.length,
    violations,
    missingRoleHelper,
    agencyPoliciesMissingAgencyHelper,
  };
}

export function findMetadataRlsInPost039Migrations(): string[] {
  const hits: string[] = [];

  for (const file of listPost039MigrationFiles()) {
    const result = scanMigrationFile(`${MIGRATIONS_DIR}/${file}`);
    for (const violation of result.violations) {
      hits.push(`${MIGRATIONS_DIR}/${file}: ${violation}`);
    }
  }

  return hits;
}

export function findRollbackFilesInMigrations(): string[] {
  const absDir = path.join(REPO_ROOT, MIGRATIONS_DIR);
  return fs
    .readdirSync(absDir)
    .filter(
      (name) =>
        name.endsWith('.sql') &&
        (name.includes('rollback') || name.includes('revert')),
    )
    .map((name) => `${MIGRATIONS_DIR}/${name}`);
}
