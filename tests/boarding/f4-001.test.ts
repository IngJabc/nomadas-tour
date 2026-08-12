/**
 * @vitest-environment node
 *
 * F4-001 — contracts for schedule_agency_digests (migration 061),
 * digest worker wiring, event/handler surface. No live DB.
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

const migration061 = read(
  'supabase/migrations/061_schedule_agency_digests.sql',
);
const harness = read('supabase/tests/f4_001_verification.sql');

describe('F4-001 — migration isolation', () => {
  it('keeps 061 as tip after contiguous 059→060→061', () => {
    const migrations = listMigrations();
    const i059 = migrations.indexOf('059_schedule_trip_reminders.sql');
    const i060 = migrations.indexOf('060_purge_completed_outbox_events.sql');
    const i061 = migrations.indexOf('061_schedule_agency_digests.sql');

    expect(i060).toBe(i059 + 1);
    expect(i061).toBe(i060 + 1);
    expect(i061).toBe(migrations.length - 1);
  });

  it('has no tracked modifications in migrations 001–060', () => {
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
        return Number(match[1]) <= 60;
      });

    expect(historicalChanges).toEqual([]);
  });
});

describe('F4-001 — schedule_agency_digests RPC structure', () => {
  it('is SECURITY DEFINER, service_role only, active+email+ops_digest', () => {
    expect(migration061).toContain(
      'CREATE OR REPLACE FUNCTION public.schedule_agency_digests(',
    );
    expect(migration061).toContain('CREATE OR REPLACE FUNCTION public.emit_agency_event(');
    expect(migration061).toContain('SECURITY DEFINER');
    expect(migration061).toContain('SET search_path = public');
    expect(migration061).toContain("status = 'active'");
    expect(migration061).toContain("category = 'ops_digest'");
    expect(migration061).toContain('email_enabled = TRUE');
    expect(migration061).toContain('FOR UPDATE OF a SKIP LOCKED');
    expect(migration061).toContain("event_type");
    expect(migration061).toContain("'agency.digest.due'");
    expect(migration061).toContain("'agency.digest.due:'");
    expect(migration061).toContain("'America/Caracas'");
    expect(migration061).toContain(
      'GRANT EXECUTE ON FUNCTION public.schedule_agency_digests(INTEGER, TEXT) TO service_role',
    );
    expect(migration061).toContain(
      'REVOKE EXECUTE ON FUNCTION public.schedule_agency_digests(INTEGER, TEXT) FROM PUBLIC',
    );
    expect(migration061).toContain(
      'REVOKE EXECUTE ON FUNCTION public.schedule_agency_digests(INTEGER, TEXT) FROM anon',
    );
    expect(migration061).toContain(
      'REVOKE EXECUTE ON FUNCTION public.schedule_agency_digests(INTEGER, TEXT) FROM authenticated',
    );
    expect(migration061).toContain(
      'GRANT EXECUTE ON FUNCTION public.emit_agency_event(TEXT, UUID, JSONB, TEXT) TO service_role',
    );
  });

  it('backfills ops_digest preference category', () => {
    expect(migration061).toContain("'ops_digest'");
    expect(migration061).toContain('agency_notification_preferences_category_check');
    expect(migration061).toContain('ON CONFLICT (agency_id, category) DO NOTHING');
  });

  it('emits agency aggregate with tenant_id = agency_id', () => {
    expect(migration061).toContain("'agency'");
    expect(migration061).toContain('p_agency_id');
    expect(migration061).toContain('aggregate_type');
    expect(migration061).toContain('tenant_id');
  });
});

describe('F4-001 — behavioral SQL harness', () => {
  it('provides a non-destructive BEGIN / ROLLBACK harness', () => {
    expect(harness).toMatch(/\bBEGIN\s*;/i);
    expect(harness.trimEnd()).toMatch(/ROLLBACK;$/i);
    expect(harness).toContain('schedule_agency_digests');
    expect(harness).toContain('emit_agency_event');
    expect(harness).toContain('agency.digest.due');
    expect(harness).toContain('PASS: A)');
    expect(harness).toContain('ops_digest');
    expect(harness).toContain('service_role');
  });
});

describe('F4-001 — worker wiring', () => {
  it('wires digest scheduler into runner alongside reminder and retention', () => {
    const runner = read('backend/src/workers/runner.ts');
    expect(runner).toContain('startDigestScheduler');
    expect(runner).toContain('createDefaultDigestSchedulerDeps');
    expect(runner).toContain('startReminderScheduler');
    expect(runner).toContain('startRetentionScheduler');
    expect(runner).toContain('digestScheduler.done');
    expect(runner).toContain('agency_digest_via_worker');
    expect(runner).not.toContain('pg_cron');
  });

  it('registers agency.digest.due handler without NotificationFanout', () => {
    const handlers = read('backend/src/workers/handlers/index.ts');
    const event = read('backend/src/events/agency-digest-due.v1.ts');
    expect(handlers).toContain('AGENCY_DIGEST_DUE_V1_TYPE');
    expect(handlers).toContain('createAgencyDigestFanoutHandler');
    expect(event).toContain("AGENCY_DIGEST_DUE_V1_TYPE = 'agency.digest.due'");
    // Digest is email-only in v1 (no NotificationFanout compose for this event).
    const digestBlock = handlers.split('F4-001')[1] ?? '';
    expect(digestBlock).toContain('createAgencyDigestFanoutHandler()');
    expect(digestBlock).not.toContain('createNotificationFanoutHandler');
  });

  it('keeps AGENCY_DIGEST_VIA_WORKER default false', () => {
    const env = read('backend/src/config/env.ts');
    expect(env).toContain('AGENCY_DIGEST_VIA_WORKER: z');
    expect(
      env
        .split('AGENCY_DIGEST_VIA_WORKER: z')[1]
        ?.split('AGENCY_DIGEST_POLL_MS')[0],
    ).toContain('.default(false)');
  });

  it('documents digest env defaults in .env-example', () => {
    const envExample = read('backend/.env-example');
    expect(envExample).toContain('AGENCY_DIGEST_VIA_WORKER=false');
    expect(envExample).toContain('AGENCY_DIGEST_POLL_MS=3600000');
    expect(envExample).toContain('AGENCY_DIGEST_BATCH=50');
  });

  it('implements digest-scheduler with window + flag skip statuses', () => {
    const scheduler = read('backend/src/workers/digest-scheduler.ts');
    expect(scheduler).toContain('startDigestScheduler');
    expect(scheduler).toContain('schedule_agency_digests');
    expect(scheduler).toContain('digest_scheduler_started');
    expect(scheduler).toContain('digest_scheduler_tick');
    expect(scheduler).toContain('digest_scheduler_error');
    expect(scheduler).toContain('digest_scheduler_stopped');
    expect(scheduler).toContain('skipped_effect_disabled');
    expect(scheduler).toContain('skipped_outside_window');
    expect(scheduler).toContain('AGENCY_DIGEST_LOCAL_HOUR = 7');
    expect(scheduler).toContain('timer.unref');
  });

  it('uses email_type agency_digest and preference ops_digest', () => {
    const handler = read(
      'backend/src/workers/handlers/agency-digest-fanout.handler.ts',
    );
    expect(handler).toContain("'agency_digest'");
    expect(handler).toContain("'ops_digest'");
    expect(handler).toContain('email_delivery_log');
    expect(handler).toContain('tenancy_mismatch');
  });

  it('loads aggregates with 48h window, limit 10, no PII activity', () => {
    const service = read('backend/src/services/agency-digest.service.ts');
    expect(service).toContain('AGENCY_DIGEST_UPCOMING_HOURS = 48');
    expect(service).toContain('AGENCY_DIGEST_UPCOMING_LIMIT = 10');
    expect(service).toContain('businessDayBoundsUtc');
    expect(service).toContain(".eq('agency_id', agencyId)");
    expect(service).not.toContain('booker_name');
    expect(service).not.toContain('boarding_logs');
  });

  it('includes AgencyDigestEmail template and sendAgencyDigestEmail', () => {
    const template = read('backend/src/templates/agency-digest-email.tsx');
    const emailService = read('backend/src/services/email.service.ts');
    expect(template).toContain('Resumen operativo diario');
    expect(template).not.toContain('booker');
    expect(emailService).toContain('sendAgencyDigestEmail');
  });
});
