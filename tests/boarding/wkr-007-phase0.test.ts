/**
 * @vitest-environment node
 *
 * WKR-007 Fase 0 — static contracts for infrastructure migrations + utils extraction.
 * No live DB; mirrors outbox-foundation.test.ts pattern.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function read(rel: string) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function listMigrations(): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'supabase/migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort();
}

describe('WKR-007 Fase 0 — migration numbering', () => {
  it('adds 052–055 without touching 001–051', () => {
    const files = listMigrations();
    expect(files).toContain('051_recover_stuck_outbox_events.sql');
    expect(files).toContain('052_trips_created_at_updated_at.sql');
    expect(files).toContain('053_outbox_events_dedup_key.sql');
    expect(files).toContain('054_notifications_source_event_id.sql');
    expect(files).toContain('055_email_delivery_log.sql');

    // 001–051 must still exist; no rewrite of 049
    expect(files).toContain('049_outbox_events.sql');
    const m049 = read('supabase/migrations/049_outbox_events.sql');
    expect(m049).toContain('outbox_emit_reservation_created');
    expect(m049).toContain('trg_reservations_outbox_created');
    expect(m049).not.toContain('dedup_key');
  });
});

describe('WKR-007 Fase 0 — 052 trips.created_at / updated_at', () => {
  const sql = read('supabase/migrations/052_trips_created_at_updated_at.sql');

  it('adds created_at NOT NULL DEFAULT NOW with documented backfill', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ');
    expect(sql).toContain('ALTER COLUMN created_at SET DEFAULT NOW()');
    expect(sql).toContain('ALTER COLUMN created_at SET NOT NULL');
    expect(sql).toMatch(/backfill|NOW\(\)/i);
    expect(sql).toMatch(/no reliable|no trip\.\*|reservation\.created/i);
  });

  it('creates trips_updated_at BEFORE UPDATE trigger without duplicating function', () => {
    expect(sql).toContain('DROP TRIGGER IF EXISTS trips_updated_at ON public.trips');
    expect(sql).toContain('CREATE TRIGGER trips_updated_at');
    expect(sql).toContain('BEFORE UPDATE ON public.trips');
    expect(sql).toContain('EXECUTE FUNCTION public.update_updated_at()');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.update_updated_at');
  });
});

describe('WKR-007 Fase 0 — 053 outbox dedup_key', () => {
  const sql = read('supabase/migrations/053_outbox_events_dedup_key.sql');

  it('adds nullable dedup_key and partial unique index', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS dedup_key TEXT NULL');
    expect(sql).toContain('idx_outbox_events_dedup_key_unique');
    expect(sql).toContain('WHERE dedup_key IS NOT NULL');
    expect(sql).toContain('duplicate non-null');
  });

  it('does not modify trigger 049 / reservation.created emitter', () => {
    expect(sql).not.toContain('outbox_emit_reservation_created');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION');
    expect(sql).not.toContain('trg_reservations_outbox_created');
    expect(sql).not.toMatch(
      /CREATE\s+TRIGGER|CREATE\s+OR\s+REPLACE\s+FUNCTION/i,
    );
  });
});

describe('WKR-007 Fase 0 — 054 notifications.source_event_id', () => {
  const sql = read('supabase/migrations/054_notifications_source_event_id.sql');

  it('adds source_event_id and normalized partial unique index', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS source_event_id UUID NULL');
    expect(sql).toContain('idx_notifications_source_event_idempotent');
    expect(sql).toContain("COALESCE(agency_id::text, '*')");
    expect(sql).toContain("COALESCE(recipient_role, '*')");
    expect(sql).toContain('WHERE source_event_id IS NOT NULL');
    expect(sql).not.toContain('REFERENCES public.outbox_events');
  });
});

describe('WKR-007 Fase 0 — 055 email_delivery_log', () => {
  const sql = read('supabase/migrations/055_email_delivery_log.sql');

  it('creates ledger with composite PK and pending/sent statuses', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.email_delivery_log');
    expect(sql).toContain(
      'PRIMARY KEY (event_id, recipient_id, email_type)',
    );
    expect(sql).toContain("status IN ('pending', 'sent')");
    expect(sql).toContain('attempts');
    expect(sql).toContain('sent_at');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_delivery_log TO service_role');
    expect(sql).toContain('do NOT add to supabase_realtime');
  });
});

describe('WKR-007 Fase 0 — utils extraction (no behavior change)', () => {
  it('extracts helpers to utils/email-fanout and SuperadminService imports them', () => {
    const utils = read('backend/src/utils/email-fanout.ts');
    const service = read('backend/src/services/superadmin.service.ts');

    expect(utils).toContain('export async function getAgenciesWithEmail');
    expect(utils).toContain('export function formatDateForEmail');
    expect(utils).toContain("toLocaleDateString('es-VE'");
    expect(utils).toContain("timeZone: 'America/Caracas'");
    expect(utils).toContain("a.status === 'active' && a.email");

    expect(service).toContain('../utils/email-fanout.js');
    expect(service).toContain('getAgenciesWithEmail');
    expect(service).toContain('formatDateForEmail');
    expect(service).not.toMatch(/private async getAgenciesWithEmail/);
    expect(service).not.toMatch(/private formatDateForEmail/);
  });

  it('keeps trip effects disabled while enabling the Phase 1 dispatcher', () => {
    const env = read('backend/src/config/env.ts');
    const runner = read('backend/src/workers/runner.ts');
    const handlers = read('backend/src/workers/handlers/index.ts');
    const superadminSvc = read('backend/src/services/superadmin.service.ts');
    const tripSvc = read('backend/src/services/trip.service.ts');

    expect(env).toContain('TRIP_EFFECTS_VIA_OUTBOX: z');
    expect(
      env.split('TRIP_EFFECTS_VIA_OUTBOX: z')[1]?.split('OUTBOX_POLL_MS')[0],
    ).toContain('.default(false)');
    expect(env).toContain('EMAIL_VIA_OUTBOX');
    // C2+C3: superadmin + completeExpiredTrips wired; handlers remain C4/C5
    expect(superadminSvc).toContain('TRIP_EFFECTS_VIA_OUTBOX');
    expect(superadminSvc).toContain('.rpc("create_trip"');
    expect(tripSvc).toContain('TRIP_EFFECTS_VIA_OUTBOX');
    expect(tripSvc).toContain('complete_trip');
    expect(runner).toContain('eventType: null');
    expect(runner).not.toContain("eventType: 'reservation.created'");
    expect(handlers).toContain('composeHandlers');
    expect(handlers).toContain('reservationEmailHandler');
    expect(handlers).toContain('reservationNotificationPlaceholder');
    expect(handlers).not.toContain('notification-fanout');
    expect(handlers).not.toMatch(/trip\.(created|postponed|cancelled|completed|auto_completed|updated|archived)/);
  });
});

describe('WKR-007 Phase 0.1 — audit remediation contracts', () => {
  it('documents ON CONFLICT DO NOTHING without conflict_target (HIGH-1)', () => {
    const design = read(
      'docs/WKR-007-trip-notification-event-workers-design.md',
    );
    expect(design).toContain('### 9.4 Invariante `ON CONFLICT`');
    expect(design).toContain('SQLSTATE 42P10');
    expect(design).toContain('ON CONFLICT DO NOTHING');
    expect(design).toContain(
      'No** usar `ON CONFLICT (source_event_id, agency_id, recipient_role)',
    );
    expect(design).toMatch(
      /preferir `ON CONFLICT DO NOTHING` \*\*sin\*\* target/i,
    );
  });

  it('documents email_delivery_log pending/sent trade-off', () => {
    const design = read(
      'docs/WKR-007-trip-notification-event-workers-design.md',
    );
    expect(design).toContain("status = 'pending'");
    expect(design).toContain("status = 'sent'");
    expect(design).toMatch(/DELETE.*requeue|requeue/i);
    expect(design).toContain('puede quedar en');
    expect(design).toContain('undelivered-ack');
    expect(design).toContain('evitar un segundo envío');
  });

  it('corrects trips.updated_at baseline drift (010/011 → 052)', () => {
    const design = read(
      'docs/WKR-007-trip-notification-event-workers-design.md',
    );
    expect(design).toMatch(/010_drop_all|011_create_all/);
    expect(design).toContain('ADD COLUMN IF NOT EXISTS');
    expect(design).not.toMatch(
      /trips` tiene `updated_at` \(006:62\) pero \*\*NO tiene `created_at`\*\*/,
    );
  });

  it('verification SQL uses seeded updated_at probe (SQL Editor safe)', () => {
    const sql = read('supabase/tests/wkr_007_phase0_verification.sql');
    expect(sql).toContain("2000-01-01");
    expect(sql).toContain('clock_timestamp()');
    expect(sql).toContain('trips_updated_at trigger did not bump updated_at');
    expect(sql).toContain('DELETE FROM public.trips WHERE id = v_trip_id');
    expect(sql).not.toContain('pg_sleep');
    expect(sql).not.toContain('wkr007_p0_trip_probe');
  });

  it('verification SQL covers source_event_id cases A–F', () => {
    const sql = read('supabase/tests/wkr_007_phase0_verification.sql');
    expect(sql).toContain('PASS: A)');
    expect(sql).toContain('PASS: B)');
    expect(sql).toContain('PASS: C)');
    expect(sql).toContain('PASS: D)');
    expect(sql).toContain('PASS: E)');
    expect(sql).toContain('PASS: F)');
    expect(sql).toContain('ON CONFLICT DO NOTHING');
    expect(sql).toContain("NULL, 'superadmin'");
    expect(sql).toContain('agency_id IS NULL');
  });

  it('verification SQL covers email_delivery_log posture', () => {
    const sql = read('supabase/tests/wkr_007_phase0_verification.sql');
    expect(sql).toContain('has_table_privilege');
    expect(sql).toContain('service_role');
    expect(sql).toContain('anon');
    expect(sql).toContain('authenticated');
    expect(sql).toContain('relrowsecurity');
    expect(sql).toContain('pending→sent');
    expect(sql).toContain('attempts CHECK');
  });

  it('leaves pre-existing frontend timezone flake out of scope', () => {
    // ACCEPTED outside WKR-007: root suite formatDateTime timezone flake.
    // Do not patch that frontend unit under this ticket.
    const design = read(
      'docs/WKR-007-trip-notification-event-workers-design.md',
    );
    expect(design).not.toContain('formatDateTime');
    expect(read('backend/package.json')).not.toContain('formatDateTime');
  });

  it('does not modify migrations 052–055 in Phase 0.1 remediation', () => {
    // Static presence only — content must still match Fase 0 contracts.
    const m054 = read('supabase/migrations/054_notifications_source_event_id.sql');
    expect(m054).toContain('idx_notifications_source_event_idempotent');
    expect(m054).toContain("COALESCE(agency_id::text, '*')");
    expect(m054).toContain("COALESCE(recipient_role, '*')");
  });
});
