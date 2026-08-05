/**
 * @vitest-environment node
 *
 * AUD-020.12 — Realtime cross-agency boarding visibility (static regressions).
 *
 * Live matrix (A boards / B boards → both receive) requires applying 048
 * and two agency sessions; covered here via policy + subscription contracts.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function read(rel: string) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('AUD-020.12 — root cause contracts', () => {
  it('scanner subscribes to boarding_logs by trip_id (not agency_id)', () => {
    const scan = read('app/agency/scan/page.tsx');
    expect(scan).toContain('subscribeToBoardingLogs');
    // second arg is tripId from scanResult.trip.id
    expect(scan).toMatch(/subscribeToBoardingLogs\(\(\)\s*=>\s*\{[\s\S]*?\},\s*tripId\)/);

    const subs = read('lib/realtime/subscriptions.ts');
    const start = subs.indexOf('export function subscribeToBoardingLogs');
    const end = subs.indexOf('export function subscribeToRoutes');
    const block = subs.slice(start, end);
    expect(block).toContain('trip_id=eq.');
    expect(block).toContain('scanned_by_agency_id=eq.');
  });

  it('pre-048 ownership-only policy is superseded by 048 trip_agencies path', () => {
    const legacy = read(
      'supabase/migrations/039_rls_identity_from_public_users_v2.sql',
    );
    // Documented baseline: ownership via reservations.agency_id
    expect(legacy).toContain('bl_agency_read');
    expect(legacy).toContain('r.agency_id = (SELECT private.auth_app_agency_id())');

    const fix = read(
      'supabase/migrations/048_boarding_logs_trip_agency_realtime_read.sql',
    );
    expect(fix).toContain('DROP POLICY IF EXISTS "bl_agency_read"');
    expect(fix).toContain('CREATE POLICY "bl_agency_read"');
    expect(fix).toContain('trip_agencies');
    expect(fix).toContain('ta.trip_id = boarding_logs.trip_id');
    expect(fix).toContain('private.auth_app_agency_id()');
    expect(fix).toContain('private.auth_app_role()');
    expect(fix).not.toMatch(/auth\.jwt\s*\(/);
    expect(fix).not.toContain('user_metadata');
  });

  it('does not widen reservation_passengers SELECT (PII isolation)', () => {
    const fix = read(
      'supabase/migrations/048_boarding_logs_trip_agency_realtime_read.sql',
    );
    expect(fix).not.toMatch(/CREATE POLICY\s+"rp_agency_read"/);
    expect(fix).not.toMatch(
      /ON public\.reservation_passengers/,
    );
    expect(fix).not.toMatch(/CREATE OR REPLACE FUNCTION[\s\S]*boarding_toggle/);
  });

  it('event path remains boarding_toggle → boarding_logs → scanner refetch', () => {
    const rpc = read('supabase/migrations/046_boarding_toggle_rpc.sql');
    expect(rpc).toContain('INSERT INTO public.boarding_logs');
    expect(rpc).toContain('trip_id');

    const scan = read('app/agency/scan/page.tsx');
    expect(scan).toContain('lookupByQR(currentCredentialRef.current, true)');
  });
});

describe('AUD-020.12 — expected realtime matrix (documented)', () => {
  /**
   * After 048, both agencies assigned to Trip X must be able to SELECT
   * boarding_logs rows for that trip_id. Matrix:
   *
   * Reserva de A | A aborda → A y B reciben
   * Reserva de A | B aborda → A y B reciben
   * Agencia C no asignada → no recibe
   */
  it('documents symmetric trip-assigned delivery', () => {
    const doc = read('docs/AUD-020.12-realtime-cross-agency-debug.md');
    expect(doc).toContain('trip_agencies');
    expect(doc).toContain('boarding_logs');
    expect(doc).toContain('048');
    expect(doc).toMatch(/B \*\*no\*\* recibe|B no recibe/);
  });
});
