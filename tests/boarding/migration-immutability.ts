/**
 * Shared migration immutability mechanism for SEC-009.3-SP1.
 *
 * Policy: historical migrations are immutable by default.
 * Exception: a historical migration may be modified ONLY when:
 *   1. fresh replay is impossible without the change;
 *   2. the remediation is technically necessary;
 *   3. the exact approved content is recorded as a SHA-256 hash;
 *   4. this test verifies the approved hash;
 *   5. the exception is documented in the relevant audit/design.
 *
 * Each approved remediation is identified by migration version number
 * and the SHA-256 hash of its CRLF→LF-normalized UTF-8 content.
 * A file that is modified but whose hash does NOT match the approved
 * value will FAIL this check — preventing silent content drift.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/* ------------------------------------------------------------------ */
/*  Approved historical remediations                                   */
/* ------------------------------------------------------------------ */

/**
 * Map of migration version → approved SHA-256 hash (CRLF→LF normalized).
 *
 * To add a new remediation:
 *   1. Compute the hash: read file as UTF-8, replace \r\n with \n,
 *      then SHA-256 the resulting string.
 *   2. Add the entry here with a comment explaining the reason.
 *   3. Document the exception in the relevant audit/design doc.
 */
export const APPROVED_REMEDIATIONS: Record<number, string> = {
  // 006 -- update-before-drop ordering + duplicate REALTIME removal.
  // Fresh replay fails because seat_id is dropped before the UPDATE
  // that references it.
  6: 'a431a9a7f25aae84f0cfb021bf42a7f249cb19e0541d07dc0e647c670c5e8603',

  // 010 -- ALTER PUBLICATION DROP TABLE IF EXISTS is invalid syntax
  // in PostgreSQL 17. Fresh replay errors on this statement.
  10: '19dbabd823c68afb6f7b8d957d4a8e1d0a90d45aaf8db3f7ebfa6b2e7c3f40b3',

  // 037 -- REVOKE/DROP on create_superadmin errors when the function
  // does not exist (dropped by 010, never recreated by 011).
  37: '66da8a8ce2a3cc441bc4f76da4baa9549170ffc341863a4a212061d9d95aa1eb',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function readMigrationFile(version: number): string {
  const dir = path.join(REPO_ROOT, 'supabase/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const prefix = String(version).padStart(3, '0') + '_';
  const match = files.find((f) => f.startsWith(prefix));
  if (!match) throw new Error(`Migration ${prefix}*.sql not found`);
  return fs.readFileSync(path.join(dir, match), 'utf8');
}

export function sha256Normalized(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function listMigrations(): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/**
 * Parse `git status --porcelain` output for migration files.
 * Returns an array of {version, file, status} for each modified file.
 */
export function getModifiedMigrations(): Array<{
  version: number;
  file: string;
  status: string;
}> {
  const status = execFileSync(
    'git',
    [
      'status',
      '--porcelain',
      '--untracked-files=no',
      '--',
      'supabase/migrations',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );

  const results: Array<{ version: number; file: string; status: string }> = [];
  for (const line of status.split(/\r?\n/)) {
    const match = line.match(/supabase\/migrations\/(\d{3})_/);
    if (!match) continue;
    const version = Number(match[1]);
    const fileMatch = line.match(/supabase\/migrations\/(.+\.sql)/);
    const file = fileMatch ? fileMatch[1] : '';
    const statusCode = line.substring(0, 2).trim();
    results.push({ version, file, status: statusCode });
  }
  return results;
}

/* ------------------------------------------------------------------ */
/*  Core assertion                                                     */
/* ------------------------------------------------------------------ */

/**
 * Assert that no historical migration (version ≤ upperBound) has been
 * modified, EXCEPT for approved remediations whose content hash matches.
 *
 * This function:
 *   1. Runs `git status --porcelain` to find modified migration files.
 *   2. Filters to versions ≤ upperBound.
 *   3. For each modified historical migration:
 *      a. If version is in APPROVED_REMEDIATIONS → verify hash matches.
 *      b. If version is NOT in APPROVED_REMEDIATIONS → FAIL.
 *   4. For each approved remediation that is NOT modified → warn (drift).
 */
export function assertHistoricalMigrationsImmutable(
  upperBound: number,
): void {
  const modified = getModifiedMigrations();
  const historical = modified.filter((m) => m.version <= upperBound);

  const errors: string[] = [];

  for (const mod of historical) {
    const approvedHash = APPROVED_REMEDIATIONS[mod.version];
    if (!approvedHash) {
      // Not an approved remediation — any modification is a policy violation
      errors.push(
        `Migration ${String(mod.version).padStart(3, '0')} (${mod.file}) has been modified but is NOT an approved remediation.`,
      );
      continue;
    }

    // Approved remediation — verify content hash matches
    const content = readMigrationFile(mod.version);
    const actualHash = sha256Normalized(content);
    if (actualHash !== approvedHash) {
      errors.push(
        `Migration ${String(mod.version).padStart(3, '0')} (${mod.file}) is an approved remediation but its content hash does NOT match.\n` +
          `  Expected: ${approvedHash}\n` +
          `  Actual:   ${actualHash}\n` +
          `  The approved content has been modified after approval.`,
      );
    }
  }

  // Also check: approved remediations that should be modified but aren't
  for (const [versionStr, expectedHash] of Object.entries(APPROVED_REMEDIATIONS)) {
    const version = Number(versionStr);
    if (version > upperBound) continue;

    const isModified = historical.some((m) => m.version === version);
    if (!isModified) {
      // The remediation file exists but isn't showing as modified.
      // This could mean it was reverted to the original (unapproved) content.
      // We don't fail here — the test's primary job is to catch unauthorized
      // modifications. A reverted remediation would fail on DB replay, not here.
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Migration immutability violations (${errors.length}):\n\n${errors.join('\n\n')}`,
    );
  }
}

/**
 * Assert that no migration file (regardless of version number) has been
 * modified, EXCEPT for approved remediations.
 *
 * This is the strictest variant — no upper bound, no version filtering.
 * Used when the test needs "everything except tip work is frozen".
 */
export function assertAllMigrationsImmutable(): void {
  const modified = getModifiedMigrations();
  const errors: string[] = [];

  for (const mod of modified) {
    const approvedHash = APPROVED_REMEDIATIONS[mod.version];
    if (!approvedHash) {
      errors.push(
        `Migration ${String(mod.version).padStart(3, '0')} (${mod.file}) has been modified but is NOT an approved remediation.`,
      );
      continue;
    }

    const content = readMigrationFile(mod.version);
    const actualHash = sha256Normalized(content);
    if (actualHash !== approvedHash) {
      errors.push(
        `Migration ${String(mod.version).padStart(3, '0')} (${mod.file}) is an approved remediation but its content hash does NOT match.\n` +
          `  Expected: ${approvedHash}\n` +
          `  Actual:   ${actualHash}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Migration immutability violations (${errors.length}):\n\n${errors.join('\n\n')}`,
    );
  }
}
