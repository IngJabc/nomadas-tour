/**
 * @vitest-environment node
 *
 * WKR-009 — contracts for purge_completed_outbox_events (migration 060),
 * behavioral harness, and retention worker wiring. No live DB.
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

const migration060 = read(
  'supabase/migrations/060_purge_completed_outbox_events.sql',
);
const harness = read('supabase/tests/wkr_009_verification.sql');

describe('WKR-009 — migration isolation', () => {
  it('keeps 060 contiguous after 059; tip may advance with later tickets', () => {
    const migrations = listMigrations();
    const i058 = migrations.indexOf(
      '058_remove_trip_deleted_notification_type.sql',
    );
    const i059 = migrations.indexOf('059_schedule_trip_reminders.sql');
    const i060 = migrations.indexOf('060_purge_completed_outbox_events.sql');

    expect(i059).toBe(i058 + 1);
    expect(i060).toBe(i059 + 1);
    expect(i060).toBeGreaterThanOrEqual(0);
    expect(migrations[migrations.length - 1]).toMatch(/^\d{3}_/);
  });

  it('has no tracked modifications in migrations 001–059', () => {
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
    const historicalChanges = status
      .split(/\r?\n/)
      .filter((line) => {
        const match = line.match(/supabase\/migrations\/(\d{3})_/);
        if (!match) return false;
        return Number(match[1]) <= 59;
      });

    expect(historicalChanges).toEqual([]);
  });
});

describe('WKR-009 — purge_completed_outbox_events RPC structure', () => {
  it('is SECURITY DEFINER, service_role only, completed-only', () => {
    expect(migration060).toContain(
      'CREATE OR REPLACE FUNCTION public.purge_completed_outbox_events(',
    );
    expect(migration060).toContain('SECURITY DEFINER');
    expect(migration060).toContain('SET search_path = public');
    expect(migration060).toContain("status = 'completed'");
    expect(migration060).toContain(
      'COALESCE(e.processed_at, e.updated_at)',
    );
    expect(migration060).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration060).toContain(
      'GRANT EXECUTE ON FUNCTION public.purge_completed_outbox_events(INTEGER, INTEGER) TO service_role',
    );
    expect(migration060).toContain(
      'REVOKE EXECUTE ON FUNCTION public.purge_completed_outbox_events(INTEGER, INTEGER) FROM PUBLIC',
    );
    expect(migration060).toContain(
      'REVOKE EXECUTE ON FUNCTION public.purge_completed_outbox_events(INTEGER, INTEGER) FROM anon',
    );
    expect(migration060).toContain(
      'REVOKE EXECUTE ON FUNCTION public.purge_completed_outbox_events(INTEGER, INTEGER) FROM authenticated',
    );
  });

  it('clamps batch to 1000 and days to >=30', () => {
    expect(migration060).toContain(
      'LEAST(GREATEST(COALESCE(p_batch, 1000), 1), 1000)',
    );
    expect(migration060).toContain(
      'GREATEST(COALESCE(p_older_than_days, 30), 30)',
    );
    expect(migration060).toContain('p_batch INTEGER DEFAULT 1000');
    expect(migration060).toContain('p_older_than_days INTEGER DEFAULT 30');
  });

  it('does not accept status as a parameter or purge failed', () => {
    expect(migration060).not.toMatch(/p_status/i);
    expect(migration060).not.toMatch(/status\s*=\s*'failed'/);
    expect(migration060).not.toMatch(/status\s*=\s*'pending'/);
    expect(migration060).not.toMatch(/status\s*=\s*'processing'/);
    expect(migration060).not.toMatch(/CREATE\s+INDEX/i);
  });

  it('does not grant DELETE on outbox_events', () => {
    expect(migration060).not.toMatch(
      /GRANT\s+.*DELETE.*ON\s+TABLE\s+public\.outbox_events/i,
    );
  });
});

describe('WKR-009 — behavioral SQL harness', () => {
  it('provides a non-destructive BEGIN / ROLLBACK harness covering A–J', () => {
    expect(harness).toMatch(/\bBEGIN\s*;/i);
    expect(harness.trimEnd()).toMatch(/ROLLBACK;$/i);
    expect(harness).toContain('purge_completed_outbox_events');
    expect(harness).toContain('PASS: A)');
    expect(harness).toContain('PASS: B)');
    expect(harness).toContain('PASS: C)');
    expect(harness).toContain('PASS: D)');
    expect(harness).toContain('PASS: E)');
    expect(harness).toContain('PASS: F)');
    expect(harness).toContain('PASS: G)');
    expect(harness).toContain('PASS: H)');
    expect(harness).toContain('PASS: I)');
    expect(harness).toContain('PASS: J)');
    expect(harness).toContain('FOR UPDATE SKIP LOCKED');
    expect(harness).toContain('SECURITY DEFINER');
  });
});

describe('WKR-009 — worker wiring', () => {
  it('wires retention scheduler into runner alongside reminder', () => {
    const runner = read('backend/src/workers/runner.ts');
    expect(runner).toContain('startRetentionScheduler');
    expect(runner).toContain('createDefaultRetentionSchedulerDeps');
    expect(runner).toContain('startReminderScheduler');
    expect(runner).toContain('reminderScheduler.done');
    expect(runner).toContain('retentionScheduler.done');
    expect(runner).toContain('outbox_retention_via_worker');
    expect(runner).not.toContain('pg_cron');
  });

  it('exposes retention config on worker runtime config', () => {
    const config = read('backend/src/workers/config.ts');
    expect(config).toContain('outboxRetentionViaWorker');
    expect(config).toContain('outboxRetentionPollMs');
    expect(config).toContain('outboxRetentionBatch');
    expect(config).toContain('outboxRetentionDays');
    expect(config).toContain('OUTBOX_RETENTION_VIA_WORKER');
  });

  it('keeps OUTBOX_RETENTION_VIA_WORKER default false', () => {
    const env = read('backend/src/config/env.ts');
    expect(env).toContain('OUTBOX_RETENTION_VIA_WORKER: z');
    expect(
      env
        .split('OUTBOX_RETENTION_VIA_WORKER: z')[1]
        ?.split('OUTBOX_RETENTION_POLL_MS')[0],
    ).toContain('.default(false)');
    expect(env).toContain('OUTBOX_RETENTION_POLL_MS');
    expect(env).toContain('OUTBOX_RETENTION_BATCH');
    expect(env).toContain('OUTBOX_RETENTION_DAYS');
  });

  it('documents retention env defaults in .env-example', () => {
    const envExample = read('backend/.env-example');
    expect(envExample).toContain('OUTBOX_RETENTION_VIA_WORKER=false');
    expect(envExample).toContain('OUTBOX_RETENTION_POLL_MS=86400000');
    expect(envExample).toContain('OUTBOX_RETENTION_BATCH=1000');
    expect(envExample).toContain('OUTBOX_RETENTION_DAYS=30');
  });

  it('implements retention-scheduler module', () => {
    const scheduler = read('backend/src/workers/retention-scheduler.ts');
    expect(scheduler).toContain('startRetentionScheduler');
    expect(scheduler).toContain('purge_completed_outbox_events');
    expect(scheduler).toContain('retention_scheduler_started');
    expect(scheduler).toContain('retention_scheduler_tick');
    expect(scheduler).toContain('retention_scheduler_error');
    expect(scheduler).toContain('retention_scheduler_stopped');
    expect(scheduler).toContain('skipped_effect_disabled');
    expect(scheduler).toContain('timer.unref');
  });
});
