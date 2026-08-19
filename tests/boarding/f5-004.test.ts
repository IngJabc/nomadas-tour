/**
 * @vitest-environment node
 *
 * F5-004 — migration tip / isolation for reservation-link (067–069).
 * Live SQL harness: supabase/tests/f5_004_verification.sql.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function listMigrations(): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, 'supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

describe('F5-004 — migration isolation', () => {
  it('keeps 066→067→068→069→070→071→072 contiguous and 072 as tip', () => {
    const migrations = listMigrations();
    const i066 = migrations.indexOf('066_create_agency_reservation_departed.sql');
    const i067 = migrations.indexOf('067_reservation_links.sql');
    const i068 = migrations.indexOf('068_seat_lock_expires_at.sql');
    const i069 = migrations.indexOf('069_reservation_link_rpcs.sql');
    const i070 = migrations.indexOf('070_reservation_links_agency_realtime.sql');
    const i071 = migrations.indexOf('071_invalidate_reservation_link.sql');
    const i072 = migrations.indexOf('072_reservation_link_agency_branding.sql');
    expect(i067).toBe(i066 + 1);
    expect(i068).toBe(i067 + 1);
    expect(i069).toBe(i068 + 1);
    expect(i070).toBe(i069 + 1);
    expect(i071).toBe(i070 + 1);
    expect(i072).toBe(i071 + 1);
    expect(i072).toBe(migrations.length - 1);
  });

  it('ships the SQL verification harness', () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, 'supabase/tests/f5_004_verification.sql')),
    ).toBe(true);
  });

  it('071 adds invalidate_reservation_link without seat release', () => {
    const sql = fs.readFileSync(
      path.join(REPO_ROOT, 'supabase/migrations/071_invalidate_reservation_link.sql'),
      'utf8',
    );
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.invalidate_reservation_link');
    expect(sql).toContain("status = 'cancelled'");
    expect(sql).not.toContain("SET status = 'available'");
    expect(sql).not.toContain('locked_by = NULL');
  });

  it('070 grants agency SELECT + realtime without anon or public writes', () => {
    const sql = fs.readFileSync(
      path.join(REPO_ROOT, 'supabase/migrations/070_reservation_links_agency_realtime.sql'),
      'utf8',
    );
    expect(sql).toContain('GRANT SELECT ON TABLE public.reservation_links TO authenticated');
    expect(sql).toContain('reservation_links_agency_select');
    expect(sql).toContain("private.auth_app_agency_id()");
    expect(sql).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.reservation_links');
    expect(sql).not.toContain('TO anon');
    expect(sql).not.toContain('reservation_link_seats');
    expect(sql).not.toContain('GRANT INSERT');
    expect(sql).not.toContain('GRANT UPDATE');
  });

  });
