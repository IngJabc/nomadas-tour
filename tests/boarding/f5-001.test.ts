/**
 * @vitest-environment node
 *
 * F5-001 — migration tip / isolation contracts for 065_audit_log.sql.
 * Live DB behavior lives in supabase/tests/f5_001_verification.sql.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function listMigrations(): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

const migration065 = read('supabase/migrations/065_audit_log.sql');
const harness = read('supabase/tests/f5_001_verification.sql');

describe('F5-001 — migration isolation', () => {
  it('keeps 064→065 contiguous; 066 is tip after departed-reservation fix', () => {
    const migrations = listMigrations();
    const i064 = migrations.indexOf('064_occupancy_urgency_alerts.sql');
    const i065 = migrations.indexOf('065_audit_log.sql');
    const i066 = migrations.indexOf('066_create_agency_reservation_departed.sql');
    expect(i065).toBe(i064 + 1);
    expect(i066).toBe(i065 + 1);
    expect(i066).toBe(migrations.length - 1);
  });

  it('has no tracked modifications in migrations 001–064', () => {
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
    const dirtyHistorical = status
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((line) => !line.includes('065_audit_log.sql'))
      .filter((line) => !line.includes('066_create_agency_reservation_departed.sql'));
    expect(dirtyHistorical).toEqual([]);
  });

  it('defines audit_log append-only + audit_append + nine actions', () => {
    expect(migration065).toContain('CREATE TABLE public.audit_log');
    expect(migration065).toContain('ERR_AUDIT_APPEND_ONLY');
    expect(migration065).toContain('CREATE OR REPLACE FUNCTION public.audit_append');
    for (const action of [
      'trip.created',
      'trip.updated',
      'trip.cancelled',
      'reservation.created',
      'reservation.cancelled',
      'boarding.board',
      'boarding.unboard',
      'agency_settings.updated',
      'notification_preferences.updated',
    ]) {
      expect(migration065).toContain(`'${action}'`);
    }
    expect(migration065).not.toMatch(/set_config\s*\(/i);
    expect(migration065).toContain('DROP POLICY IF EXISTS bl_agency_insert');
    expect(migration065).toContain(
      'DROP POLICY IF EXISTS reservations_agency_insert',
    );
  });

  it('ships a verification harness covering security/atomicity/PII', () => {
    expect(harness).toContain('ERR_AUDIT_APPEND_ONLY');
    expect(harness).toContain('ATOM1');
    expect(harness).toContain('PII');
    expect(harness).toContain('ROLLBACK');
  });
});
