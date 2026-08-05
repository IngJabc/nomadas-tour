/**
 * @vitest-environment node
 *
 * WKR-004 — static contracts for outbox migration (no workers).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function read(rel: string) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('WKR-004 — outbox migration static contract', () => {
  const migration = read('supabase/migrations/049_outbox_events.sql');

  it('creates outbox_events with required columns and indexes', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.outbox_events');
    expect(migration).toContain('event_type');
    expect(migration).toContain('event_version');
    expect(migration).toContain('aggregate_type');
    expect(migration).toContain('aggregate_id');
    expect(migration).toContain('tenant_id');
    expect(migration).toContain('payload');
    expect(migration).toContain("status IN ('pending', 'processing', 'completed', 'failed')");
    expect(migration).toContain('idx_outbox_events_status_available_at');
    expect(migration).toContain('idx_outbox_events_aggregate');
  });

  it('emits reservation.created via trigger without modifying create_agency_reservation', () => {
    expect(migration).toContain('outbox_emit_reservation_created');
    expect(migration).toContain('trg_reservations_outbox_created');
    expect(migration).toContain("'reservation.created'");
    expect(migration).toContain('AFTER INSERT ON public.reservations');
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.create_agency_reservation');
    expect(migration).not.toContain('auth.jwt');
    expect(migration).not.toContain('user_metadata');
  });

  it('locks table to service_role and keeps it off realtime', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.outbox_events FROM anon');
    expect(migration).toContain('REVOKE ALL ON TABLE public.outbox_events FROM authenticated');
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.outbox_events TO service_role');
    expect(migration).toContain('do NOT add to supabase_realtime');
  });

  it('payload build has no PII fields', () => {
    expect(migration).toContain("'reservation_id', NEW.id");
    expect(migration).toContain("'trip_id', NEW.trip_id");
    expect(migration).toContain("'agency_id', NEW.agency_id");
    expect(migration).not.toMatch(/booker_document|booker_phone|qr_code|contact_email/);
  });
});
