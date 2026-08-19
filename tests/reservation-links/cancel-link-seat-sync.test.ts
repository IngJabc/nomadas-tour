/**
 * @vitest-environment node
 *
 * Regression — cancel link after F5-004 must sync wizard seat state.
 *
 * Bug: "Cancelar enlace" calls cancel_reservation_link (which releases seats
 * in the DB), but the frontend keeps those seats in selectedSeats. The next
 * toggleSeat → unlockSeat → 404 because seats are already released.
 *
 * Fix: cancelActiveLinkWithRelease calls locking.syncSeatsAfterCancel() which
 * refetches the trip and drops seats no longer locked by the current user.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const WIZARD_PAGE = 'app/agency/reservations/new/page.tsx';
const HOOK = 'hooks/useSeatLocking.ts';

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

// ─── useSeatLocking exposes syncSeatsAfterCancel ──────────────────────
describe('cancel link — syncSeatsAfterCancel in useSeatLocking', () => {
  const src = read(HOOK);

  it('declares syncSeatsAfterCancel as a useCallback', () => {
    expect(src).toMatch(/const syncSeatsAfterCancel = useCallback/);
  });

  it('refetches the trip via agencyApi.getTrip', () => {
    expect(src).toContain('const syncSeatsAfterCancel = useCallback');
    expect(src).toMatch(/syncSeatsAfterCancel[\s\S]*?agencyApi\.getTrip/);
  });

  it('updates seatsMap with fresh seat data', () => {
    expect(src).toMatch(/syncSeatsAfterCancel[\s\S]*?setSeatsMap/);
  });

  it('filters selectedSeats to only seats still locked by current user', () => {
    expect(src).toMatch(/syncSeatsAfterCancel[\s\S]*?setSelectedSeats/);
    expect(src).toMatch(/freshSeat\.status === 'locked'/);
    expect(src).toMatch(/freshSeat\.locked_by === userIdRef\.current/);
  });

  it('returns Promise<void> in the interface', () => {
    expect(src).toMatch(/syncSeatsAfterCancel:\s*\(\)\s*=>\s*Promise<void>/);
  });

  it('is exposed in the return object', () => {
    const returnBlock = src.slice(src.indexOf('return {'));
    expect(returnBlock).toContain('syncSeatsAfterCancel,');
  });
});

// ─── cancelActiveLinkWithRelease calls syncSeatsAfterCancel ───────────
describe('cancel link — cancelActiveLinkWithRelease calls sync', () => {
  const src = read(WIZARD_PAGE);

  it('calls locking.syncSeatsAfterCancel() after the cancel API call', () => {
    const fnBody = src.slice(
      src.indexOf('const cancelActiveLinkWithRelease'),
      src.indexOf('}, [clearActiveLinkLocal, locking]'),
    );
    expect(fnBody).toContain('agencyApi.cancelReservationLink');
    expect(fnBody).toContain('locking.syncSeatsAfterCancel()');
  });

  it('syncSeatsAfterCancel is called AFTER the await (not inside try/catch)', () => {
    const fnBody = src.slice(
      src.indexOf('const cancelActiveLinkWithRelease'),
      src.indexOf('}, [clearActiveLinkLocal, locking]'),
    );
    const cancelIdx = fnBody.indexOf('cancelReservationLink');
    const syncIdx = fnBody.indexOf('syncSeatsAfterCancel');
    expect(syncIdx).toBeGreaterThan(cancelIdx);
  });

  it('does NOT modify selectedSeats directly (delegates to hook)', () => {
    const fnBody = src.slice(
      src.indexOf('const cancelActiveLinkWithRelease'),
      src.indexOf('}, [clearActiveLinkLocal, locking]'),
    );
    expect(fnBody).not.toContain('setSelectedSeats');
  });

  it('does NOT call unlockAllCurrent (preserves wizard lifecycle)', () => {
    const fnBody = src.slice(
      src.indexOf('const cancelActiveLinkWithRelease'),
      src.indexOf('}, [clearActiveLinkLocal, locking]'),
    );
    expect(fnBody).not.toContain('unlockAllCurrent');
  });

  it('locking is the only dependency (no selectedTrip?.id)', () => {
    const depMatch = src.match(
      /const cancelActiveLinkWithRelease = useCallback[\s\S]*?}, \[([^\]]+)\]/,
    );
    expect(depMatch).not.toBeNull();
    const deps = depMatch![1];
    expect(deps).toContain('clearActiveLinkLocal');
    expect(deps).toContain('locking');
    expect(deps).not.toContain('selectedTrip');
  });
});

// ─── handleBackFromSeats still uses unlockAllCurrent (not broken) ────
describe('cancel link — other flows unchanged', () => {
  const src = read(WIZARD_PAGE);

  it('handleBackFromSeats still calls unlockAllCurrent + resetSeats', () => {
    const backBlock = src.slice(
      src.indexOf('const handleBackFromSeats'),
      src.indexOf('}, [locking, wizard, stopCountdown, cancelActiveLinkWithRelease]'),
    );
    expect(backBlock).toContain('unlockAllCurrent');
    expect(backBlock).toContain('resetSeats');
  });

  it('handleReset still calls resetSeats', () => {
    const resetBlock = src.slice(
      src.indexOf('const handleReset'),
      src.indexOf('}, [submit, locking, wizard, router, stopCountdown, cancelActiveLinkWithRelease]'),
    );
    expect(resetBlock).toContain('locking.resetSeats()');
  });

  it('handleLockExpired still calls unlockAllCurrent + clearSelection', () => {
    const expiredBlock = src.slice(
      src.indexOf('const handleLockExpired'),
      src.indexOf('}, [locking, wizard, invalidateActiveLink]'),
    );
    expect(expiredBlock).toContain('unlockAllCurrent');
    expect(expiredBlock).toContain('clearSelection');
  });
});

// ─── cancel_reservation_link SQL releases seats ───────────────────────
describe('cancel link — DB behavior', () => {
  const sql = read('supabase/migrations/069_reservation_link_rpcs.sql');

  it('cancel_reservation_link sets seats to available', () => {
    const cancelFn = sql.slice(
      sql.indexOf('cancel_reservation_link'),
      sql.indexOf('cancel_reservation_link') + 2000,
    );
    expect(cancelFn).toContain("SET status = 'available'");
    expect(cancelFn).toContain('locked_by = NULL');
    expect(cancelFn).toContain('locked_at = NULL');
    expect(cancelFn).toContain('lock_expires_at = NULL');
  });

  it('cancel_reservation_link only affects seats that are locked', () => {
    const cancelFn = sql.slice(
      sql.indexOf('cancel_reservation_link'),
      sql.indexOf('cancel_reservation_link') + 2000,
    );
    expect(cancelFn).toContain("AND status = 'locked'");
  });

  it('invalidate_reservation_link does NOT touch seats', () => {
    const invalidateSql = read('supabase/migrations/071_invalidate_reservation_link.sql');
    expect(invalidateSql).not.toContain("SET status = 'available'");
    expect(invalidateSql).not.toContain('locked_by = NULL');
    expect(invalidateSql).not.toContain('locked_at = NULL');
    expect(invalidateSql).not.toContain('lock_expires_at = NULL');
  });
});
