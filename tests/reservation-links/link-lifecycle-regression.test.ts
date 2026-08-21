/**
 * @vitest-environment node
 *
 * Regression — F5-004 reservation link lifecycle fixes.
 *
 * 1. HTTP 409 race condition: deterministic invalidation in handleCreateLink
 *    prevents stale active links from blocking new link creation.
 * 2. Wizard abandonment: unmount cleanup effect invalidates the active link.
 * 3. Public page: client-side validation, expired/invalidated states.
 * 4. TTL: lockSeat produces lock_expires_at ≈ NOW + 600s.
 * 5. Invalidate after HTTP success: clearActiveLinkLocal runs only after
 *    backend confirms invalidation.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  validatePublicLinkDraft,
  hasPublicLinkValidationErrors,
  type LinkDataForm,
} from '@/lib/reservation-links';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const WIZARD_PAGE = 'app/agency/reservations/new/page.tsx';
const PUBLIC_PAGE = 'app/reservations/link/page.tsx';

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

// ─── Objective 1: HTTP 409 race condition fix ────────────────────────
describe('F5-004 — HTTP 409 race condition fix', () => {
  const src = read(WIZARD_PAGE);

  it('declares pendingInvalidationRef to track invalidation promises', () => {
    expect(src).toContain('pendingInvalidationRef');
    expect(src).toMatch(/useRef<.*Promise.*>\(null\)/);
  });

  it('stores the invalidation promise in pendingInvalidationRef', () => {
    expect(src).toMatch(/pendingInvalidationRef\.current\s*=\s*p;/);
  });

  it('awaits pendingInvalidationRef before creating a new link', () => {
    const createBlock = src.slice(
      src.indexOf('const handleCreateLink'),
      src.indexOf('setCreatingLink(true)'),
    );
    expect(createBlock).toMatch(/await pendingInvalidationRef\.current/);
  });

  it('clears pendingInvalidationRef after completion', () => {
    expect(src).toMatch(
      /if\s*\(pendingInvalidationRef\.current === p\)\s*\{[\s\S]*?pendingInvalidationRef\.current = null/,
    );
  });
});

// ─── Objective 1b: Deterministic invalidation in handleCreateLink ────
describe('F5-004 — deterministic invalidation before link creation', () => {
  const src = read(WIZARD_PAGE);

  it('retries invalidation when activeLinkRef still set after pending', () => {
    const createBlock = src.slice(
      src.indexOf('const handleCreateLink'),
      src.indexOf('setCreatingLink(true)'),
    );
    expect(createBlock).toContain('activeLinkRef.current');
    expect(createBlock).toContain('invalidateReservationLink(activeLinkRef.current.id)');
    expect(createBlock).toContain('clearActiveLinkLocal()');
  });

  it('shows error toast and aborts when retry fails', () => {
    const createBlock = src.slice(
      src.indexOf('const handleCreateLink'),
      src.indexOf('setCreatingLink(true)'),
    );
    expect(createBlock).toContain('No se pudo invalidar el enlace anterior');
    expect(createBlock).toMatch(/return;\s*\}\s*\}/);
  });

  it('compares seat sets to distinguish intentional active from stale', () => {
    const createBlock = src.slice(
      src.indexOf('const handleCreateLink'),
      src.indexOf('setCreatingLink(true)'),
    );
    expect(createBlock).toContain('currentSeatCodes');
    expect(createBlock).toContain('linkSeatCodes');
    expect(createBlock).toContain('seatsMatch');
  });

  it('continues with existing link when seats match (no invalidation)', () => {
    const createBlock = src.slice(
      src.indexOf('const handleCreateLink'),
      src.indexOf('setCreatingLink(true)'),
    );
    expect(createBlock).toContain('El enlace sigue activo y copiado');
  });

  it('clears local state only after HTTP invalidation succeeds', () => {
    const createBlock = src.slice(
      src.indexOf('const handleCreateLink'),
      src.indexOf('setCreatingLink(true)'),
    );
    expect(createBlock).toContain('clearActiveLinkLocal();');
    expect(createBlock).toContain('clearActiveLinkMemory(retryId)');
  });
});

// ─── Objective 1c: invalidateActiveLink clears state after HTTP success
describe('F5-004 — invalidateActiveLink clears state after HTTP success', () => {
  const src = read(WIZARD_PAGE);

  it('does NOT call clearActiveLinkLocal before the HTTP call', () => {
    const invalidateBlock = src.slice(
      src.indexOf('const invalidateActiveLink'),
      src.indexOf('}));', src.indexOf('const invalidateActiveLink')),
    );
    const httpCallIdx = invalidateBlock.indexOf('agencyApi.invalidateReservationLink');
    const clearIdx = invalidateBlock.indexOf('clearActiveLinkLocal');
    expect(httpCallIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(httpCallIdx);
  });

  it('does NOT swallow errors with .catch(() => {})', () => {
    const invalidateBlock = src.slice(
      src.indexOf('const invalidateActiveLink'),
      src.indexOf('}));', src.indexOf('const invalidateActiveLink')),
    );
    expect(invalidateBlock).not.toContain('.catch(() => {})');
  });

  it('returns a boolean indicating success/failure', () => {
    const invalidateBlock = src.slice(
      src.indexOf('const invalidateActiveLink'),
      src.indexOf('}));', src.indexOf('const invalidateActiveLink')),
    );
    expect(invalidateBlock).toContain('return true');
    expect(invalidateBlock).toContain('return false');
  });

  it('preserves activeLinkRef on HTTP failure (returns false)', () => {
    const invalidateBlock = src.slice(
      src.indexOf('const invalidateActiveLink'),
      src.indexOf('}));', src.indexOf('const invalidateActiveLink')),
    );
    const catchBlock = invalidateBlock.slice(
      invalidateBlock.indexOf('catch {'),
    );
    expect(catchBlock).toContain('return false');
  });
});

// ─── Objective 1d: Smart comparison toast only on success ────────────
describe('F5-004 — smart comparison toasts only on success', () => {
  const src = read(WIZARD_PAGE);

  it('does not fire toast synchronously when selection changes', () => {
    const comparisonBlock = src.slice(
      src.indexOf('Smart comparison'),
      src.indexOf('Step transitions'),
    );
    // The toast must be inside .then(), NOT as a direct statement
    expect(comparisonBlock).toMatch(/invalidateActiveLink\(\)\.then\(/);
    // Verify no synchronous toast("El enlace se canceló") exists outside .then()
    const thenIdx = comparisonBlock.indexOf('.then(');
    const beforeThen = comparisonBlock.slice(0, thenIdx);
    expect(beforeThen).not.toMatch(/toast\(["']El enlace se canceló/);
  });

  it('fires toast inside .then() callback of invalidateActiveLink', () => {
    const comparisonBlock = src.slice(
      src.indexOf('Smart comparison'),
      src.indexOf('Step transitions'),
    );
    expect(comparisonBlock).toMatch(/invalidateActiveLink\(\)\.then\(/);
    expect(comparisonBlock).toContain('El enlace se canceló');
  });
});

// ─── Objective 1e: TTL defaults ──────────────────────────────────────
describe('F5-004 — TTL defaults to 600s', () => {
  it('backend env.ts default is 600', () => {
    const envSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'backend/src/config/env.ts'),
      'utf8',
    );
    expect(envSrc).toMatch(/LOCK_TTL_SECONDS:\s*z\.coerce\.number\(\)\.default\(600\)/);
  });

  it('frontend useLockCountdown default is 600', () => {
    const hookSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'hooks/useLockCountdown.ts'),
      'utf8',
    );
    expect(hookSrc).toMatch(/ttlSeconds\s*=\s*600/);
  });
});

// ─── Objective 4: Wizard abandonment cleanup ─────────────────────────
describe('F5-004 — wizard abandonment cleanup', () => {
  const src = read(WIZARD_PAGE);

  it('has an unmount cleanup effect that invalidates the link', () => {
    const cleanupPattern = /return\s*\(\s*\)\s*=>\s*\{[\s\S]*?invalidateReservationLink[\s\S]*?\};/;
    expect(src).toMatch(cleanupPattern);
  });

  it('clears sessionStorage in the unmount cleanup', () => {
    const unmountBlock = src.slice(
      src.indexOf('Wizard abandonment'),
    );
    expect(unmountBlock).toContain('clearActiveLinkMemory');
  });

  it('does NOT unlock seats in the unmount cleanup (wizard lifecycle handles that)', () => {
    const unmountBlock = src.slice(
      src.indexOf('Wizard abandonment'),
      src.indexOf('Derived state'),
    );
    expect(unmountBlock).not.toContain('unlockAllCurrent');
    expect(unmountBlock).not.toContain('unlockSeat');
    expect(unmountBlock).not.toContain('sendUnlockKeepalive');
  });
});

// ─── Objective 5: sessionStorage recovery vs abandonment ─────────────
describe('F5-004 — sessionStorage recovery', () => {
  const src = read(WIZARD_PAGE);

  it('validates stored link with backend before restoring', () => {
    const recoveryBlock = src.slice(
      src.indexOf('Recover active link after remount'),
      src.indexOf('Smart comparison'),
    );
    expect(recoveryBlock).toContain('getReservationLink');
    expect(recoveryBlock).toContain("detail.status !== 'active'");
  });

  it('clears sessionStorage when backend confirms link is not active', () => {
    const recoveryBlock = src.slice(
      src.indexOf('Recover active link after remount'),
      src.indexOf('Smart comparison'),
    );
    expect(recoveryBlock).toContain('clearActiveLinkMemory');
  });
});

// ─── Objective 2: Smart comparison — set identity ────────────────────
describe('F5-004 — smart comparison uses Set identity', () => {
  const src = read(WIZARD_PAGE);

  it('compares seat sets using Set, not array order', () => {
    const comparisonBlock = src.slice(
      src.indexOf('Smart comparison'),
      src.indexOf('Step transitions'),
    );
    expect(comparisonBlock).toContain('new Set');
    expect(comparisonBlock).toContain('.every(');
    expect(comparisonBlock).toContain('.has(');
  });

  it('skips invalidation when sets are identical', () => {
    const comparisonBlock = src.slice(
      src.indexOf('Smart comparison'),
      src.indexOf('Step transitions'),
    );
    expect(comparisonBlock).toMatch(/if\s*\(!isSame\)/);
  });
});

// ─── Objectives 8-10: Public page validation ────────────────────────
describe('F5-004 — public link draft validation', () => {
  const emptyForm: LinkDataForm = {
    booker_name: '',
    booker_document: '',
    booker_phone: '',
    passengers: [{ seat_code: 'A1', name: '', document: '', phone: '' }],
  };

  it('allows empty fields (progressive save)', () => {
    const errors = validatePublicLinkDraft(emptyForm);
    expect(hasPublicLinkValidationErrors(errors)).toBe(false);
  });

  it('validates name min 2 chars when filled', () => {
    const form = { ...emptyForm, booker_name: 'A' };
    const errors = validatePublicLinkDraft(form);
    expect(errors.booker_name).toBe('Mínimo 2 caracteres');
  });

  it('validates document must be 7-8 digits', () => {
    const form = { ...emptyForm, booker_document: '12345' };
    const errors = validatePublicLinkDraft(form);
    expect(errors.booker_document).toBe('Debe tener 7 u 8 dígitos');
  });

  it('accepts 7-digit document', () => {
    const form = { ...emptyForm, booker_document: '1234567' };
    const errors = validatePublicLinkDraft(form);
    expect(errors.booker_document).toBeUndefined();
  });

  it('accepts 8-digit document', () => {
    const form = { ...emptyForm, booker_document: '12345678' };
    const errors = validatePublicLinkDraft(form);
    expect(errors.booker_document).toBeUndefined();
  });

  it('rejects document with letters', () => {
    const form = { ...emptyForm, booker_document: '1234567A' };
    const errors = validatePublicLinkDraft(form);
    expect(errors.booker_document).toBe('Debe tener 7 u 8 dígitos');
  });

  it('rejects document with 9 digits', () => {
    const form = { ...emptyForm, booker_document: '123456789' };
    const errors = validatePublicLinkDraft(form);
    expect(errors.booker_document).toBe('Debe tener 7 u 8 dígitos');
  });

  it('validates phone format when provided', () => {
    const form = { ...emptyForm, booker_phone: '04123456' };
    const errors = validatePublicLinkDraft(form);
    expect(errors.booker_phone).toBeDefined();
  });

  it('accepts valid phone 04xxxxxxxxx', () => {
    const form = { ...emptyForm, booker_phone: '04241234567' };
    const errors = validatePublicLinkDraft(form);
    expect(errors.booker_phone).toBeUndefined();
  });

  it('accepts valid phone +58424xxxxxxx', () => {
    const form = { ...emptyForm, booker_phone: '+584241234567' };
    const errors = validatePublicLinkDraft(form);
    expect(errors.booker_phone).toBeUndefined();
  });

  it('validates passenger fields when filled', () => {
    const form: LinkDataForm = {
      ...emptyForm,
      passengers: [{ seat_code: 'A1', name: 'A', document: '12', phone: 'bad' }],
    };
    const errors = validatePublicLinkDraft(form);
    expect(errors.passengers.A1?.name).toBe('Mínimo 2 caracteres');
    expect(errors.passengers.A1?.document).toBe('Debe tener 7 u 8 dígitos');
    expect(errors.passengers.A1?.phone).toBeDefined();
  });

  it('does not error on valid passenger fields', () => {
    const form: LinkDataForm = {
      ...emptyForm,
      passengers: [{ seat_code: 'A1', name: 'Carlos', document: '1234567', phone: '' }],
    };
    const errors = validatePublicLinkDraft(form);
    expect(errors.passengers.A1).toBeUndefined();
  });
});

// ─── Objectives 6+7: Public page source checks ──────────────────────
describe('F5-004 — public page state handling', () => {
  const src = read(PUBLIC_PAGE);

  it('blocks form when link is expired, cancelled, or confirmed', () => {
    expect(src).toMatch(/isBlocked\s*=\s*linkStatus\s*===\s*'expired'/);
    expect(src).toMatch(/linkStatus\s*===\s*'cancelled'/);
    expect(src).toMatch(/linkStatus\s*===\s*'confirmed'/);
  });

  it('shows invalidated state with specific message', () => {
    expect(src).toContain('Este enlace ya no es válido');
    expect(src).toContain('La agencia modificó la selección de asientos');
  });

  it('shows expired countdown state', () => {
    expect(src).toContain('Enlace expirado');
  });

  it('validates on save before submitting', () => {
    expect(src).toContain('validatePublicLinkDraft');
    expect(src).toContain('hasPublicLinkValidationErrors');
  });

  it('shows validation errors on inputs via error prop', () => {
    expect(src).toMatch(/error=\{validationErrors\.booker_name\}/);
    expect(src).toMatch(/error=\{validationErrors\.booker_document\}/);
    expect(src).toMatch(/error=\{pErrors\?\.name\}/);
  });

  it('fires expiredClient callback when countdown hits 0', () => {
    expect(src).toContain('expiredFiredRef');
    expect(src).toContain("setLinkStatus('expired')");
  });

  it('handles LINK_CANCELLED from save response', () => {
    expect(src).toContain("LINK_CANCELLED");
    expect(src).toContain("setLinkStatus('cancelled')");
  });
});
