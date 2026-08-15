/**
 * @vitest-environment node
 *
 * F4-003 — contracts for evaluate_occupancy_alerts (migration 063),
 * occupancy-alert worker wiring, event/handler/widget surface. No live DB.
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

const migration063 = read(
  'supabase/migrations/063_evaluate_occupancy_alerts.sql',
);
const harness = read('supabase/tests/f4_003_verification.sql');

describe('F4-003 — migration isolation', () => {
  it('keeps 063 contiguous after 060→061→062; tip follows latest (065)', () => {
    const migrations = listMigrations();
    const i060 = migrations.indexOf('060_purge_completed_outbox_events.sql');
    const i061 = migrations.indexOf('061_schedule_agency_digests.sql');
    const i062 = migrations.indexOf('062_schedule_superadmin_digest.sql');
    const i063 = migrations.indexOf('063_evaluate_occupancy_alerts.sql');
    const i064 = migrations.indexOf('064_occupancy_urgency_alerts.sql');
    const i065 = migrations.indexOf('065_audit_log.sql');

    expect(i061).toBe(i060 + 1);
    expect(i062).toBe(i061 + 1);
    expect(i063).toBe(i062 + 1);
    expect(i064).toBe(i063 + 1);
    expect(i065).toBe(i064 + 1);
    expect(i065).toBe(migrations.length - 1);
  });

  it('has no tracked modifications in migrations 001–062', () => {
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
        return Number(match[1]) <= 62;
      });

    expect(historicalChanges).toEqual([]);
  });
});

describe('F4-003 — evaluate_occupancy_alerts + state + prefs', () => {
  it('creates trip_occupancy_alert_state with Estrategia B constraints', () => {
    expect(migration063).toContain(
      'CREATE TABLE IF NOT EXISTS public.trip_occupancy_alert_state',
    );
    expect(migration063).toContain('trip_id UUID PRIMARY KEY');
    expect(migration063).toContain('ON DELETE CASCADE');
    expect(migration063).toContain("CHECK (alert_type IN ('near_full', 'underbooked'))");
    expect(migration063).toContain(
      "CHECK (state IN ('near_full_alerted', 'underbooked_alerted'))",
    );
    expect(migration063).not.toMatch(/state.*'normal'/i);
    expect(migration063).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trip_occupancy_alert_state TO service_role');
  });

  it('extends agency prefs with occupancy_alerts and does not touch superadmin prefs', () => {
    expect(migration063).toContain("'occupancy_alerts'");
    expect(migration063).toContain("SELECT a.id, 'occupancy_alerts', TRUE, FALSE");
    expect(migration063).toContain('ON CONFLICT (agency_id, category) DO NOTHING');
    expect(migration063).not.toMatch(
      /ALTER TABLE\s+public\.superadmin_notification_preferences/i,
    );
    expect(migration063).not.toMatch(
      /CREATE TABLE[\s\S]*superadmin_notification_preferences/i,
    );
  });

  it('extends notifications.type with occupancy_alert non-destructively', () => {
    expect(migration063).toContain('DROP CONSTRAINT IF EXISTS notifications_type_check');
    expect(migration063).toContain("'occupancy_alert'");
    expect(migration063).toContain("'trip_reminder'");
    expect(migration063).toContain("'passenger_cancelled'");
  });

  it('defines evaluate_occupancy_alerts as DEFINER service_role only with keyset', () => {
    expect(migration063).toContain(
      'CREATE OR REPLACE FUNCTION public.evaluate_occupancy_alerts(',
    );
    expect(migration063).toContain('p_after_departure');
    expect(migration063).toContain('p_after_id');
    expect(migration063).toContain('SECURITY DEFINER');
    expect(migration063).toContain('SET search_path = public');
    expect(migration063).toContain('FOR UPDATE OF t SKIP LOCKED');
    expect(migration063).toContain("emit_trip_event(");
    expect(migration063).toContain("'trip.occupancy_alert.due'");
    expect(migration063).toContain('ON CONFLICT (trip_id) DO NOTHING');
    expect(migration063).toContain('skipped_invalid_occupancy');
    expect(migration063).toContain('has_more');
    expect(migration063).toContain('next_cursor');
    expect(migration063).toContain("'has_more', v_has_more");
    expect(migration063).not.toMatch(/has_more'?, ?\(v_scanned >= v_limit\)/);
    expect(migration063).toContain(
      'GRANT EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID) TO service_role',
    );
    expect(migration063).toContain(
      'REVOKE EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID) FROM PUBLIC',
    );
    expect(migration063).toContain(
      'REVOKE EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID) FROM anon',
    );
    expect(migration063).toContain(
      'REVOKE EXECUTE ON FUNCTION public.evaluate_occupancy_alerts(INTEGER, TIMESTAMPTZ, UUID) FROM authenticated',
    );
    expect(migration063).not.toMatch(/\bpg_cron\b/);
    expect(migration063).not.toMatch(/\bemail_delivery_log\b/);
    expect(migration063).not.toMatch(/\bResend\b/);
  });

  it('uses canonical occupancy != available and one transition per trip', () => {
    expect(migration063).toContain("status <> 'available'");
    expect(migration063).toContain('v_occupancy >= 90');
    expect(migration063).toContain('v_occupancy <= 20');
    expect(migration063).toContain('v_occupancy < 85');
    expect(migration063).toContain('v_occupancy > 25');
    expect(migration063).toContain('DELETE FROM public.trip_occupancy_alert_state');
  });
});

describe('F4-003 — behavioral SQL harness', () => {
  it('provides a non-destructive BEGIN / ROLLBACK harness', () => {
    expect(harness).toMatch(/\bBEGIN\s*;/i);
    expect(harness.trimEnd()).toMatch(/ROLLBACK;$/i);
    expect(harness).toContain('evaluate_occupancy_alerts');
    expect(harness).toContain('trip_occupancy_alert_state');
    expect(harness).toContain('trip.occupancy_alert.due');
    expect(harness).toContain('PASS: A)');
    expect(harness).toContain('PASS: K)');
    expect(harness).toContain('PASS: L)');
  });
});

describe('F4-003 — worker wiring', () => {
  it('wires occupancy-alert scheduler into the existing runner', () => {
    const runner = read('backend/src/workers/runner.ts');
    expect(runner).toContain('startOccupancyAlertScheduler');
    expect(runner).toContain('createDefaultOccupancyAlertSchedulerDeps');
    expect(runner).toContain('occupancyAlertScheduler.done');
    expect(runner).toContain('occupancy_alert_via_worker');
    expect(runner).not.toContain('pg_cron');
    expect(runner).not.toMatch(/new Worker\(|worker_threads|second worker/i);
  });

  it('registers trip.occupancy_alert.due via NotificationFanout only (no EmailFanout)', () => {
    const handlers = read('backend/src/workers/handlers/index.ts');
    const fanout = read(
      'backend/src/workers/handlers/notification-fanout.handler.ts',
    );
    const event = read('backend/src/events/trip-occupancy-alert-due.v1.ts');

    expect(handlers).toContain('TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE');
    expect(handlers).toContain("createNotificationFanoutHandler('trip.occupancy_alert'");
    expect(handlers).toContain('OCCUPANCY_ALERT_VIA_WORKER');
    expect(event).toContain('TRIP_OCCUPANCY_ALERT_DUE_V1_TYPE');
    expect(event).toContain("'trip.occupancy_alert.due'");

    const occupancyBlock = handlers.split('F4-003')[1] ?? '';
    expect(occupancyBlock).toContain('createNotificationFanoutHandler');
    expect(occupancyBlock).not.toContain('createEmailFanoutHandler');
    expect(occupancyBlock).not.toContain('email_delivery_log');

    expect(fanout).toContain("case 'trip.occupancy_alert'");
    expect(fanout).toContain('/agency/trips/');
    expect(fanout).toContain('/admin/trips/');
    expect(fanout).toContain("recipient_role: 'superadmin'");
    expect(fanout).toContain('loadTripAgencyIds');
    expect(fanout).not.toMatch(/superadmin_notification_preferences/);
  });

  it('keeps OCCUPANCY_ALERT_VIA_WORKER default false', () => {
    const env = read('backend/src/config/env.ts');
    expect(env).toContain('OCCUPANCY_ALERT_VIA_WORKER: z');
    expect(
      env
        .split('OCCUPANCY_ALERT_VIA_WORKER: z')[1]
        ?.split('OCCUPANCY_ALERT_POLL_MS')[0],
    ).toContain('.default(false)');
  });

  it('documents occupancy alert env defaults in .env-example', () => {
    const envExample = read('backend/.env-example');
    expect(envExample).toContain('OCCUPANCY_ALERT_VIA_WORKER=false');
    expect(envExample).toContain('OCCUPANCY_ALERT_POLL_MS=3600000');
    expect(envExample).toContain('OCCUPANCY_ALERT_BATCH=50');
  });

  it('implements scheduler without local-hour gate', () => {
    const scheduler = read(
      'backend/src/workers/occupancy-alert-scheduler.ts',
    );
    expect(scheduler).toContain('startOccupancyAlertScheduler');
    expect(scheduler).toContain('occupancy_alert_scheduler_started');
    expect(scheduler).toContain('occupancy_alert_scheduler_tick');
    expect(scheduler).toContain('occupancy_alert_scheduler_error');
    expect(scheduler).toContain('occupancy_alert_scheduler_stopped');
    expect(scheduler).toContain('skipped_effect_disabled');
    expect(scheduler).toContain('skipped_invalid_occupancy');
    expect(scheduler).toContain('timer.unref');
    expect(scheduler).not.toContain('LOCAL_HOUR');
    expect(scheduler).not.toContain('skipped_outside_window');
  });
});

describe('F4-003 — categories + widget surface', () => {
  it('registers occupancy_alerts category and occupancy_alert type', () => {
    const categories = read(
      'backend/src/constants/notification-categories.ts',
    );
    const notif = read('backend/src/services/notification.service.ts');
    expect(categories).toContain("'occupancy_alerts'");
    expect(categories).toContain("occupancy_alert: 'occupancy_alerts'");
    expect(categories).toContain('Alertas de ocupación');
    expect(notif).toContain("'occupancy_alert'");
  });

  it('replaces agency occupancy chart composition but keeps OccupancyChart for admin', () => {
    const agencyPage = read('app/agency/page.tsx');
    const adminPage = read('app/admin/page.tsx');
    const widget = read('components/dashboard/OccupancyAlertsWidget.tsx');
    const chart = read('components/dashboard/charts/OccupancyChart.tsx');
    const reservationService = read(
      'backend/src/services/reservation.service.ts',
    );

    expect(agencyPage).toContain('OccupancyAlertsWidget');
    expect(agencyPage).not.toContain('OccupancyChart');
    expect(adminPage).toContain('OccupancyChart');
    expect(chart).toContain('Ocupación de viajes');
    expect(widget).toContain('Alertas de ocupación');
    expect(widget).toContain('Ver viaje');
    expect(widget).toContain('/agency/trips/${alert.trip_id}/passengers');
    expect(reservationService).toContain('listAgencyOccupancyAlerts');
    expect(reservationService).toContain('occupancy_alerts:');
  });

  it('widget data path does not use notifications table as source', () => {
    const service = read('backend/src/services/occupancy-alert.service.ts');
    expect(service).toContain('trip_occupancy_alert_state');
    expect(service).toContain('trip_agencies');
    expect(service).not.toMatch(/from\('notifications'\)/);
  });
});
