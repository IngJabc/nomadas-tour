/**
 * @vitest-environment node
 *
 * WKR-007.2 — static contracts for reservation.created publication
 * idempotency. No live DB; the SQL harness validates runtime behavior.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const migration049 = read('supabase/migrations/049_outbox_events.sql');
const migration056 = read(
  'supabase/migrations/056_outbox_trigger_retrofit_dedup_key.sql',
);
const harness = read('supabase/tests/wkr_007_2_verification.sql');

describe('WKR-007.2 — migration isolation', () => {
  it('keeps 049 as the original non-deduplicated event publisher', () => {
    expect(createHash('sha256').update(migration049).digest('hex')).toBe(
      '8511dc4d5872b405ee557ab7cd7585075c61490452913bf905fdb4f087f0873e',
    );
    expect(migration049).toContain(
      'CREATE OR REPLACE FUNCTION public.outbox_emit_reservation_created()',
    );
    expect(migration049).toContain(
      'CREATE TRIGGER trg_reservations_outbox_created',
    );
    expect(migration049).not.toContain('dedup_key');
    expect(migration049).not.toContain('ON CONFLICT');
  });

  it('adds only migration 056 after the Phase 0 migrations', () => {
    const migrations = listMigrations();
    expect(migrations).toContain('049_outbox_events.sql');
    expect(migrations).toContain('052_trips_created_at_updated_at.sql');
    expect(migrations).toContain('053_outbox_events_dedup_key.sql');
    expect(migrations).toContain('054_notifications_source_event_id.sql');
    expect(migrations).toContain('055_email_delivery_log.sql');
    expect(migrations).toContain(
      '056_outbox_trigger_retrofit_dedup_key.sql',
    );
  });

  it('has no tracked modifications in migrations 001–055', () => {
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
      .filter((line) => /supabase\/migrations\/(?:0[0-4]\d|05[0-5])_/.test(line));

    expect(historicalChanges).toEqual([]);
  });
});

describe('WKR-007.2 — trigger function retrofit', () => {
  it('redefines the existing SECURITY DEFINER function without adding a trigger', () => {
    expect(migration056).toContain(
      'CREATE OR REPLACE FUNCTION public.outbox_emit_reservation_created()',
    );
    expect(migration056).toContain('RETURNS TRIGGER');
    expect(migration056).toContain('SECURITY DEFINER');
    expect(migration056).toContain('SET search_path = public');
    expect(migration056).not.toMatch(/\bCREATE\s+TRIGGER\b/i);
    expect(migration056).not.toMatch(/\bDROP\s+TRIGGER\b/i);
    expect(migration056).not.toMatch(/\bALTER\s+FUNCTION\b/i);
  });

  it('adds the exact deterministic reservation.created dedup key', () => {
    expect(migration056).toContain('dedup_key');
    expect(migration056).toContain(
      "'reservation.created:' || NEW.id::text",
    );
  });

  it('uses ON CONFLICT DO NOTHING without a conflict target', () => {
    expect(migration056).toMatch(/ON\s+CONFLICT\s+DO\s+NOTHING/i);
    expect(migration056).not.toMatch(/ON\s+CONFLICT\s*\(/i);
    expect(migration056).not.toMatch(
      /ON\s+CONFLICT\s+ON\s+CONSTRAINT/i,
    );
  });

  it('preserves the reservation.created envelope and payload', () => {
    expect(migration056).toContain("'reservation.created'");
    expect(migration056).toContain("'reservation'");
    expect(migration056).toContain('NEW.id');
    expect(migration056).toContain('NEW.agency_id');
    expect(migration056).toContain("'reservation_id', NEW.id");
    expect(migration056).toContain("'trip_id', NEW.trip_id");
    expect(migration056).toContain("'agency_id', NEW.agency_id");
    expect(migration056).not.toMatch(/'trip\.[a-z_]+'/i);
  });
});

describe('WKR-007.2 — verification harness and phase boundaries', () => {
  it('provides a non-destructive BEGIN / ROLLBACK harness', () => {
    expect(harness).toMatch(/\bBEGIN\s*;/i);
    expect(harness.trimEnd()).toMatch(/ROLLBACK;$/i);
    expect(harness).toContain('SECURITY DEFINER');
    expect(harness).toContain("'reservation.created:'");
    expect(harness).toContain('expected one outbox row');
    expect(harness).toContain('legacy NULL dedup_key rows');
    expect(harness).toContain('reservation.created envelope remains unchanged');
  });

  it('keeps the multi-event runner with the C1 flag disabled and unwired', () => {
    const runner = read('backend/src/workers/runner.ts');
    const env = read('backend/src/config/env.ts');
    const superadminSvc = read('backend/src/services/superadmin.service.ts');
    const tripSvc = read('backend/src/services/trip.service.ts');
    const handlers = read('backend/src/workers/handlers/index.ts');

    expect(runner).toContain('eventType: null');
    expect(runner).not.toContain("eventType: 'reservation.created'");
    expect(env).toContain('TRIP_EFFECTS_VIA_OUTBOX: z');
    expect(
      env.split('TRIP_EFFECTS_VIA_OUTBOX: z')[1]?.split('OUTBOX_POLL_MS')[0],
    ).toContain('.default(false)');
    // C2+C3: superadmin + trip.service wired; handlers still unwired (C4/C5)
    expect(superadminSvc).toContain('TRIP_EFFECTS_VIA_OUTBOX');
    expect(superadminSvc).toContain('.rpc("create_trip"');
    expect(tripSvc).toContain('TRIP_EFFECTS_VIA_OUTBOX');
    expect(tripSvc).toContain('complete_trip');
    expect(handlers).not.toMatch(/trip\.(created|postponed|cancelled|completed|auto_completed|updated|archived)/);
    expect(handlers).not.toContain('notification-fanout');
  });
});

