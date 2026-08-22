/**
 * @vitest-environment node
 *
 * F4-002 — contracts for emit_platform_event (migration 062),
 * superadmin digest worker wiring, event/handler surface. No live DB.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { assertHistoricalMigrationsImmutable, listMigrations } from './migration-immutability';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

const migration062 = read(
  'supabase/migrations/062_schedule_superadmin_digest.sql',
);
const harness = read('supabase/tests/f4_002_verification.sql');

describe('F4-002 — migration isolation', () => {
  it('keeps 062 contiguous after 060→061; tip may advance with later tickets', () => {
    const migrations = listMigrations();
    const i060 = migrations.indexOf('060_purge_completed_outbox_events.sql');
    const i061 = migrations.indexOf('061_schedule_agency_digests.sql');
    const i062 = migrations.indexOf('062_schedule_superadmin_digest.sql');

    expect(i061).toBe(i060 + 1);
    expect(i062).toBe(i061 + 1);
    expect(i062).toBeGreaterThanOrEqual(0);
    expect(migrations[migrations.length - 1]).toMatch(/^\d{3}_/);
  });

  it('has no tracked modifications in migrations 001–061', () => {
    assertHistoricalMigrationsImmutable(61);
  });
});

describe('F4-002 — emit_platform_event + prefs', () => {
  it('creates superadmin prefs without a role CHECK on users', () => {
    expect(migration062).toContain('CREATE TABLE IF NOT EXISTS public.superadmin_notification_preferences');
    expect(migration062).toContain("CHECK (category IN ('superadmin_digest'))");
    expect(migration062).toContain('email_enabled BOOLEAN NOT NULL DEFAULT TRUE');
    expect(migration062).toContain('in_app_enabled BOOLEAN NOT NULL DEFAULT FALSE');
    expect(migration062).toContain("WHERE u.role = 'superadmin'");
    expect(migration062).toContain('ON CONFLICT (user_id, category) DO NOTHING');
    expect(migration062).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration062).toContain('REVOKE ALL ON TABLE public.superadmin_notification_preferences FROM PUBLIC');
    expect(migration062).toContain('REVOKE ALL ON TABLE public.superadmin_notification_preferences FROM anon');
    expect(migration062).toContain('REVOKE ALL ON TABLE public.superadmin_notification_preferences FROM authenticated');
    expect(migration062).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.superadmin_notification_preferences TO service_role');
    expect(migration062).not.toMatch(/CHECK\s*\([^)]*users\.role/);
  });

  it('defines emit_platform_event as DEFINER service_role only, not emit_agency_event', () => {
    expect(migration062).toContain('CREATE OR REPLACE FUNCTION public.emit_platform_event(');
    expect(migration062).toContain('SECURITY DEFINER');
    expect(migration062).toContain('SET search_path = public');
    expect(migration062).toContain('p_aggregate_type');
    expect(migration062).toContain('p_aggregate_id');
    expect(migration062).toContain('p_tenant_id');
    expect(migration062).toContain('p_payload');
    expect(migration062).toContain('p_dedup_key');
    expect(migration062).toContain('p_available_at');
    expect(migration062).toContain('ON CONFLICT DO NOTHING');
    expect(migration062).toContain(
      'GRANT EXECUTE ON FUNCTION public.emit_platform_event(TEXT, TEXT, UUID, UUID, JSONB, TEXT, TIMESTAMPTZ) TO service_role',
    );
    expect(migration062).toContain(
      'REVOKE EXECUTE ON FUNCTION public.emit_platform_event(TEXT, TEXT, UUID, UUID, JSONB, TEXT, TIMESTAMPTZ) FROM PUBLIC',
    );
    expect(migration062).toContain(
      'REVOKE EXECUTE ON FUNCTION public.emit_platform_event(TEXT, TEXT, UUID, UUID, JSONB, TEXT, TIMESTAMPTZ) FROM anon',
    );
    expect(migration062).toContain(
      'REVOKE EXECUTE ON FUNCTION public.emit_platform_event(TEXT, TEXT, UUID, UUID, JSONB, TEXT, TIMESTAMPTZ) FROM authenticated',
    );
    expect(migration062).not.toContain('emit_agency_event');
    expect(migration062).not.toMatch(/CREATE\s+EXTENSION/i);
    expect(migration062).not.toContain('pg_cron');
    expect(migration062).not.toContain('idx_superadmin_notif_prefs_user');
    expect(migration062).not.toMatch(/CREATE INDEX/i);
  });
});

describe('F4-002 — behavioral SQL harness', () => {
  it('provides a non-destructive BEGIN / ROLLBACK harness', () => {
    expect(harness).toMatch(/\bBEGIN\s*;/i);
    expect(harness.trimEnd()).toMatch(/ROLLBACK;$/i);
    expect(harness).toContain('emit_platform_event');
    expect(harness).toContain('superadmin_notification_preferences');
    expect(harness).toContain('superadmin.digest.due');
    expect(harness).toContain('service_role');
    expect(harness).toContain('PASS: A)');
  });
});

describe('F4-002 — worker wiring', () => {
  it('wires superadmin digest scheduler into the existing runner', () => {
    const runner = read('backend/src/workers/runner.ts');
    expect(runner).toContain('startSuperadminDigestScheduler');
    expect(runner).toContain('createDefaultSuperadminDigestSchedulerDeps');
    expect(runner).toContain('superadminDigestScheduler.done');
    expect(runner).toContain('startDigestScheduler');
    expect(runner).toContain('superadmin_digest_via_worker');
    expect(runner).not.toContain('pg_cron');
    expect(runner).not.toMatch(/new Worker\(|worker_threads|second worker/i);
  });

  it('registers superadmin.digest.due handler without NotificationFanout', () => {
    const handlers = read('backend/src/workers/handlers/index.ts');
    const event = read('backend/src/events/superadmin-digest-due.v1.ts');
    expect(handlers).toContain('SUPERADMIN_DIGEST_DUE_V1_TYPE');
    expect(handlers).toContain('createSuperadminDigestFanoutHandler');
    expect(event).toContain("SUPERADMIN_DIGEST_DUE_V1_TYPE = 'superadmin.digest.due'");
    expect(event).toContain("SUPERADMIN_DIGEST_DUE_V1_AGGREGATE = 'platform'");
    const digestBlock = handlers.split('F4-002')[1]?.split('F4-003')[0] ?? '';
    expect(digestBlock).toContain('createSuperadminDigestFanoutHandler()');
    expect(digestBlock).not.toContain('createNotificationFanoutHandler');
  });

  it('keeps SUPERADMIN_DIGEST_VIA_WORKER default false', () => {
    const env = read('backend/src/config/env.ts');
    expect(env).toContain('SUPERADMIN_DIGEST_VIA_WORKER: z');
    expect(
      env
        .split('SUPERADMIN_DIGEST_VIA_WORKER: z')[1]
        ?.split('SUPERADMIN_DIGEST_POLL_MS')[0],
    ).toContain('.default(false)');
  });

  it('documents superadmin digest env defaults in .env-example', () => {
    const envExample = read('backend/.env-example');
    expect(envExample).toContain('SUPERADMIN_DIGEST_VIA_WORKER=false');
    expect(envExample).toContain('SUPERADMIN_DIGEST_POLL_MS=3600000');
    expect(envExample).toContain('SUPERADMIN_DIGEST_BATCH=50');
  });

  it('implements independent scheduler with window + flag skip statuses', () => {
    const scheduler = read('backend/src/workers/superadmin-digest-scheduler.ts');
    expect(scheduler).toContain('startSuperadminDigestScheduler');
    expect(scheduler).toContain('emit_platform_event');
    expect(scheduler).not.toContain('emit_agency_event');
    expect(scheduler).toContain('superadmin_digest_scheduler_started');
    expect(scheduler).toContain('superadmin_digest_scheduler_tick');
    expect(scheduler).toContain('superadmin_digest_scheduler_error');
    expect(scheduler).toContain('superadmin_digest_scheduler_stopped');
    expect(scheduler).toContain('skipped_effect_disabled');
    expect(scheduler).toContain('skipped_outside_window');
    expect(scheduler).toContain('SUPERADMIN_DIGEST_LOCAL_HOUR = 7');
    expect(scheduler).toContain('timer.unref');
  });

  it('uses email_type superadmin_digest and skipped_empty', () => {
    const handler = read(
      'backend/src/workers/handlers/superadmin-digest-fanout.handler.ts',
    );
    const types = read('backend/src/workers/outbox/types.ts');
    const relay = read('backend/src/workers/outbox/relay.ts');
    expect(handler).toContain("'superadmin_digest'");
    expect(handler).toContain('email_delivery_log');
    expect(handler).toContain('skipped_empty');
    expect(handler).not.toContain('NotificationFanout');
    expect(handler).not.toContain('recipients.slice(0');
    expect(handler).toContain('already_logged');
    expect(types).toContain("'skipped_empty'");
    expect(relay).toContain("reason === 'skipped_empty'");
  });

  it('locks R1 as UUIDv5/SHA-1 in TypeScript only', () => {
    const uuid = read('backend/src/utils/deterministic-uuid.ts');
    expect(uuid).toContain("createHash('sha1')");
    expect(uuid).toContain('uuidV5');
    expect(uuid).toContain('nomadas-platform');
    expect(uuid).not.toMatch(/createHash\('md5'\)/);
    expect(uuid).not.toMatch(/CREATE\s+EXTENSION/i);
  });
});
