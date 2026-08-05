/**
 * @vitest-environment node
 *
 * AUD-020 P4 — static security / residue / realtime regression checks.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function read(rel: string) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function walk(relDir: string): string[] {
  const abs = path.join(REPO_ROOT, relDir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const childAbs = path.join(abs, entry.name);
    const childRel = path.relative(REPO_ROOT, childAbs).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.next'].includes(entry.name)) continue;
      out.push(...walk(childRel));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(childRel);
  }
  return out;
}

describe('AUD-020 P4 — legacy residue absent from runtime', () => {
  const roots = ['app', 'components', 'hooks', 'lib', 'backend/src'];

  it('has no legacy boarding routes/methods in runtime code', () => {
    const hits: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const content = read(file);
        if (
          /\bboardPassenger\b/.test(content) ||
          /\bboardPassengers\b/.test(content) ||
          /\blookupReservationByQR\b/.test(content) ||
          content.includes('/agency/scanner/lookup') ||
          content.includes('/agency/scanner/board') ||
          content.includes('/agency/reservations/board')
        ) {
          hits.push(file);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('boarding lookup path does not use ILIKE on qr_code', () => {
    const service = read('backend/src/services/reservation.service.ts');
    const boardingStart = service.indexOf('findReservationByExactCredential');
    const boardingEnd = service.indexOf('async toggleBoarding');
    expect(boardingStart).toBeGreaterThan(-1);
    expect(boardingEnd).toBeGreaterThan(boardingStart);
    const boardingBlock = service.slice(boardingStart, boardingEnd);
    expect(boardingBlock).not.toMatch(/\.ilike\(/);
    expect(boardingBlock).toContain(".eq('ticket_code'");
    expect(boardingBlock).toContain(".eq('qr_code'");
  });

  it('admin search may still ILIKE qr_code outside boarding (documented exception)', () => {
    const service = read('backend/src/services/reservation.service.ts');
    // Non-boarding administrative search retains ILIKE; must not live in boarding block.
    expect(service).toContain(".ilike('qr_code'");
    const boardingStart = service.indexOf('findReservationByExactCredential');
    const boardingEnd = service.indexOf('async toggleBoarding');
    const boardingBlock = service.slice(boardingStart, boardingEnd);
    expect(boardingBlock.includes(".ilike('qr_code'")).toBe(false);
  });
});

describe('AUD-020 P4 — RPC grant / DEFINER evidence in migrations', () => {
  it('046 locks EXECUTE to service_role and sets SECURITY DEFINER + search_path', () => {
    const sql = read('supabase/migrations/046_boarding_toggle_rpc.sql');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.boarding_toggle');
    expect(sql).toContain('FROM PUBLIC');
    expect(sql).toContain('FROM anon');
    expect(sql).toContain('FROM authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.boarding_toggle');
    expect(sql).toContain('TO service_role');
  });
});

describe('AUD-020 P4 — realtime / seats regression (static)', () => {
  it('toggleBoarding does not mutate seats.status', () => {
    const service = read('backend/src/services/reservation.service.ts');
    const start = service.indexOf('async toggleBoarding');
    const end = service.indexOf('async cancelPassenger');
    const block = service.slice(start, end);
    expect(block).toContain("rpc('boarding_toggle'");
    expect(block).not.toMatch(/from\('seats'\)/);
    expect(block).not.toMatch(/status:\s*'blocked'/);
    expect(block).not.toMatch(/status:\s*'boarded'/);
  });

  it('useTripRealtime still derives boarded from reservation_passengers, not seats.status boarded writes', () => {
    const hook = read('hooks/useTripRealtime.ts');
    expect(hook).toContain('reservation_passengers');
    expect(hook).toContain('boarded');
    // Must not treat boarding as a seat status write path
    expect(hook).not.toMatch(/update\(\{\s*status:\s*['\"]boarded['\"]/);
  });
});
