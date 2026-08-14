/**
 * @vitest-environment node
 *
 * F4-004 — contracts for occupancy urgency (migration 064),
 * event/handler/scheduler/widget surface. No live DB.
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

const migration064 = read('supabase/migrations/064_occupancy_urgency_alerts.sql');
const harness = read('supabase/tests/f4_004_verification.sql');

describe('F4-004 — migration isolation', () => {
  it('keeps 061→062→063→064 contiguous; tip is 064', () => {
    const migrations = listMigrations();
    const i061 = migrations.indexOf('061_schedule_agency_digests.sql');
    const i062 = migrations.indexOf('062_schedule_superadmin_digest.sql');
    const i063 = migrations.indexOf('063_evaluate_occupancy_alerts.sql');
    const i064 = migrations.indexOf('064_occupancy_urgency_alerts.sql');

    expect(i062).toBe(i061 + 1);
    expect(i063).toBe(i062 + 1);
    expect(i064).toBe(i063 + 1);
    expect(i064).toBe(migrations.length - 1);
  });

  it('has no tracked modifications in migrations 001–063', () => {
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
        return Number(match[1]) <= 63;
      });

    expect(historicalChanges).toEqual([]);
  });
});

describe('F4-004 — evaluate_occupancy_alerts urgency extension', () => {
  it('extends RPC with p_urgency_enabled default false and additive counters', () => {
    expect(migration064).toContain('p_urgency_enabled BOOLEAN DEFAULT FALSE');
    expect(migration064).toContain("'urgency_matches'");
    expect(migration064).toContain("'urgency_emitted'");
    expect(migration064).toContain("'already_escalated'");
    expect(migration064).toContain("'trip.occupancy_urgency.due'");
    expect(migration064).toContain('urgency_window');
    expect(migration064).toContain("'t24'");
    expect(migration064).toContain("INTERVAL '24 hours'");
    expect(migration064).toContain('SECURITY DEFINER');
    expect(migration064).toContain('SET search_path = public');
    expect(migration064).toContain(
      'GRANT EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID, BOOLEAN) TO service_role',
    );
    expect(migration064).toContain(
      'REVOKE EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID, BOOLEAN) FROM PUBLIC',
    );
  });

  it('does not emit urgency on NORMAL→ALERTED enter branch', () => {
    // Enter branch still uses trip.occupancy_alert.due only.
    const enterIdx = migration064.indexOf('IF v_existing_type IS NULL THEN');
    const nearFullStay = migration064.indexOf("ELSIF v_existing_type = 'near_full' THEN");
    expect(enterIdx).toBeGreaterThan(-1);
    expect(nearFullStay).toBeGreaterThan(enterIdx);
    const enterBlock = migration064.slice(enterIdx, nearFullStay);
    expect(enterBlock).toContain("'trip.occupancy_alert.due'");
    expect(enterBlock).not.toContain("'trip.occupancy_urgency.due'");
  });

  it('emits urgency only on stay-alerted branches', () => {
    expect(migration064).toMatch(
      /ELSIF v_existing_type = 'near_full'[\s\S]*trip\.occupancy_urgency\.due/,
    );
    expect(migration064).toMatch(
      /ELSIF v_existing_type = 'underbooked'[\s\S]*trip\.occupancy_urgency\.due/,
    );
  });

  it('does not introduce a new table, category, or notifications.type', () => {
    expect(migration064).not.toMatch(/CREATE TABLE/i);
    expect(migration064).not.toContain('notifications_type_check');
    expect(migration064).not.toContain('agency_notification_preferences_category_check');
    expect(migration064).not.toMatch(/CREATE EXTENSION/i);
    expect(migration064).not.toMatch(/cron\.schedule/i);
  });
});

describe('F4-004 — behavioral SQL harness', () => {
  it('provides a non-destructive BEGIN / ROLLBACK harness', () => {
    expect(harness).toMatch(/\bBEGIN\s*;/i);
    expect(harness.trimEnd()).toMatch(/ROLLBACK;$/i);
    expect(harness).toContain('evaluate_occupancy_alerts');
    expect(harness).toContain('trip.occupancy_urgency.due');
    expect(harness).toContain('p_urgency_enabled');
    expect(harness).toContain('PASS: A)');
    expect(harness).toContain('PASS: J)');
  });
});

describe('F4-004 — worker wiring', () => {
  it('passes p_urgency_enabled from OCCUPANCY_URGENCY_VIA_WORKER', () => {
    const scheduler = read('backend/src/workers/occupancy-alert-scheduler.ts');
    const env = read('backend/src/config/env.ts');
    const envExample = read('backend/.env-example');
    const runner = read('backend/src/workers/runner.ts');

    expect(env).toContain('OCCUPANCY_URGENCY_VIA_WORKER');
    expect(envExample).toContain('OCCUPANCY_URGENCY_VIA_WORKER=false');
    expect(scheduler).toContain('p_urgency_enabled');
    expect(scheduler).toContain('isUrgencyEnabled');
    expect(scheduler).toContain('urgency_matches');
    expect(scheduler).toContain('urgency_emitted');
    expect(scheduler).toContain('already_escalated');
    expect(runner).toContain('occupancy_urgency_via_worker');
  });

  it('registers trip.occupancy_urgency.due via NotificationFanout only', () => {
    const handlers = read('backend/src/workers/handlers/index.ts');
    const fanout = read(
      'backend/src/workers/handlers/notification-fanout.handler.ts',
    );
    const event = read('backend/src/events/trip-occupancy-urgency-due.v1.ts');

    expect(handlers).toContain("createNotificationFanoutHandler('trip.occupancy_urgency'");
    expect(handlers).toContain('OCCUPANCY_URGENCY_VIA_WORKER');
    expect(handlers).not.toMatch(
      /F4-004[\s\S]*createEmailFanoutHandler/,
    );
    expect(event).toContain("'trip.occupancy_urgency.due'");
    expect(fanout).toContain("case 'trip.occupancy_urgency'");
    expect(fanout).toContain('Viaje casi lleno — sale mañana');
    expect(fanout).toContain('Viaje con pocas reservas — sale mañana');
    expect(fanout).toContain('urgency: true');
    expect(fanout).toContain("type: 'occupancy_alert'");
  });
});

describe('F4-004 — UI surface', () => {
  it('extends OccupancyAlertsWidget with Sale mañana / Clock urgency', () => {
    const widget = read('components/dashboard/OccupancyAlertsWidget.tsx');
    const item = read('components/notifications/NotificationItem.tsx');
    const icons = read('components/notifications/notification-config.ts');
    const service = read('backend/src/services/occupancy-alert.service.ts');

    expect(widget).toContain('Sale mañana');
    expect(widget).toContain('Clock');
    expect(widget).toContain('urgency');
    expect(item).toContain('Sale mañana');
    expect(item).toContain('metadata?.urgency');
    expect(icons).toContain('occupancy_alert');
    expect(service).toContain('urgency:');
    expect(service).toContain('isOccupancyUrgency');
    expect(service).toContain('OCCUPANCY_URGENCY_WINDOW_MS');
    expect(service).not.toMatch(/from\('notifications'\)/);
  });
});
