/**
 * @vitest-environment node
 *
 * WKR-008 — contracts for schedule_trip_reminders (migration 059),
 * behavioral harness, and reminder worker wiring. No live DB.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { assertHistoricalMigrationsImmutable, listMigrations } from './migration-immutability';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

const migration059 = read(
  'supabase/migrations/059_schedule_trip_reminders.sql',
);
const harness = read('supabase/tests/wkr_008_verification.sql');

describe('WKR-008 — migration isolation', () => {
  it('keeps 059 contiguous after 056→057→058; 060 follows (tip may advance)', () => {
    const migrations = listMigrations();
    const i056 = migrations.indexOf('056_outbox_trigger_retrofit_dedup_key.sql');
    const i057 = migrations.indexOf('057_trip_events_rpc.sql');
    const i058 = migrations.indexOf(
      '058_remove_trip_deleted_notification_type.sql',
    );
    const i059 = migrations.indexOf('059_schedule_trip_reminders.sql');
    const i060 = migrations.indexOf('060_purge_completed_outbox_events.sql');

    expect(i057).toBe(i056 + 1);
    expect(i058).toBe(i057 + 1);
    expect(i059).toBe(i058 + 1);
    expect(i060).toBe(i059 + 1);
    expect(i060).toBeGreaterThanOrEqual(0);
  });

  it('has no tracked modifications in migrations 001–058', () => {
    assertHistoricalMigrationsImmutable(58);
  });
});

describe('WKR-008 — schedule_trip_reminders RPC structure', () => {
  it('is SECURITY DEFINER, service_role only, uses emit_trip_event', () => {
    expect(migration059).toContain(
      'CREATE OR REPLACE FUNCTION public.schedule_trip_reminders(',
    );
    expect(migration059).toContain('SECURITY DEFINER');
    expect(migration059).toContain('SET search_path = public');
    expect(migration059).toContain('PERFORM public.emit_trip_event(');
    expect(migration059).toContain("'trip.reminder_due'");
    expect(migration059).toContain(
      'GRANT EXECUTE ON FUNCTION public.schedule_trip_reminders(INTEGER) TO service_role',
    );
    expect(migration059).toContain(
      'REVOKE EXECUTE ON FUNCTION public.schedule_trip_reminders(INTEGER) FROM anon',
    );
    expect(migration059).toContain(
      'REVOKE EXECUTE ON FUNCTION public.schedule_trip_reminders(INTEGER) FROM authenticated',
    );
  });

  it('computes window inline before NOT EXISTS dedup pre-filter', () => {
    expect(migration059).toContain('NOT EXISTS');
    expect(migration059).toMatch(
      /CASE\s+WHEN t\.departure_time <= v_now \+ INTERVAL '24 hours' THEN 't24'\s+ELSE 't48'\s+END/s,
    );
    // Pre-filter must not reference the PL/pgSQL v_window variable (would be NULL).
    const candidateQuery = migration059.slice(
      migration059.indexOf('FOR v_trip IN'),
      migration059.indexOf('LOOP'),
    );
    expect(candidateQuery).toContain('NOT EXISTS');
    expect(candidateQuery).not.toContain('v_window');
    expect(candidateQuery).toContain("'t24'");
    expect(candidateQuery).toContain("'t48'");
  });

  it('revalidates under FOR UPDATE OF t SKIP LOCKED (TOCTOU)', () => {
    expect(migration059).toContain('FOR UPDATE OF t SKIP LOCKED');
    expect(migration059).toContain("v_locked.status <> 'active'");
    expect(migration059).toContain('v_locked.departure_time');
  });

  it('only allows t48 and t24 window literals (no t2/t22)', () => {
    expect(migration059).toContain("'t48'");
    expect(migration059).toContain("'t24'");
    // Quoted window literals only (avoid matching prose/comments).
    expect(migration059).not.toMatch(/'t22'|trip_reminder_t22/i);
    expect(migration059).not.toMatch(/'t2'/);
    const windowAssignments = migration059.match(/:=\s*'t\d+'/g) ?? [];
    expect(windowAssignments.every((a) => /'t48'|'t24'/.test(a))).toBe(true);
  });

  it('respects p_batch with default 50 and hard cap 500', () => {
    expect(migration059).toContain('p_batch INTEGER DEFAULT 50');
    expect(migration059).toContain('LEAST(p_batch, 500)');
  });

  it('adds trip_reminder notification type and trip_reminders preference category', () => {
    expect(migration059).toContain("'trip_reminder'");
    expect(migration059).toContain("'trip_reminders'");
    expect(migration059).toContain(
      'agency_notification_preferences_category_check',
    );
    expect(migration059).toContain('ON CONFLICT (agency_id, category) DO NOTHING');
  });
});

describe('WKR-008 — behavioral SQL harness', () => {
  it('provides a non-destructive BEGIN / ROLLBACK harness covering A–J', () => {
    expect(harness).toMatch(/\bBEGIN\s*;/i);
    expect(harness.trimEnd()).toMatch(/ROLLBACK;$/i);
    expect(harness).toContain('schedule_trip_reminders');
    expect(harness).toContain("PASS: A)");
    expect(harness).toContain("PASS: B)");
    expect(harness).toContain("PASS: C)");
    expect(harness).toContain("PASS: D)");
    expect(harness).toContain("PASS: E)");
    expect(harness).toContain("PASS: F)");
    expect(harness).toContain("PASS: G)");
    expect(harness).toContain("PASS: H)");
    expect(harness).toContain("PASS: I)");
    expect(harness).toContain("PASS: J)");
    expect(harness).toContain('catch-up');
    expect(harness).toContain('dedup');
    expect(harness).toContain('postpon');
    expect(harness).toContain('p_batch');
  });

  it('asserts catch-up never emits retrospective t48', () => {
    expect(harness).toContain('only t24');
    expect(harness).toContain('no retrospective t48');
  });
});

describe('WKR-008 — worker wiring', () => {
  it('wires reminder scheduler into runner without a second process', () => {
    const runner = read('backend/src/workers/runner.ts');
    expect(runner).toContain('startReminderScheduler');
    expect(runner).toContain('createDefaultReminderSchedulerDeps');
    expect(runner).toContain('trip_reminder_via_outbox');
    expect(runner).not.toContain('pg_cron');
  });

  it('registers composed reminder + notification handlers', () => {
    const handlers = read('backend/src/workers/handlers/index.ts');
    expect(handlers).toContain('TRIP_REMINDER_DUE_V1_TYPE');
    expect(handlers).toContain('createReminderFanoutHandler');
    expect(handlers).toContain("'trip_reminder'");
    expect(handlers).toContain('TRIP_REMINDER_VIA_OUTBOX');
  });

  it('keeps TRIP_REMINDER_VIA_OUTBOX default false', () => {
    const env = read('backend/src/config/env.ts');
    expect(env).toContain('TRIP_REMINDER_VIA_OUTBOX: z');
    expect(
      env
        .split('TRIP_REMINDER_VIA_OUTBOX: z')[1]
        ?.split('REMINDER_SCHEDULE_POLL_MS')[0],
    ).toContain('.default(false)');
    expect(env).toContain('REMINDER_SCHEDULE_POLL_MS');
    expect(env).toContain('REMINDER_SCHEDULE_BATCH');
  });

  it('does not activate the reminder flag in code defaults', () => {
    const envExample = read('backend/.env-example');
    expect(envExample).toContain('TRIP_REMINDER_VIA_OUTBOX=false');
  });
});
