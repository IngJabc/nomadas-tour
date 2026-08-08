/**
 * @vitest-environment node
 *
 * Regression — "Nueva reserva" after booking must leave the ticket mode.
 *
 * Scenario guarded: while on `/agency/reservations/new?reservation_id=<id>`
 * (post-booking ticket screen), clicking "Nueva reserva" runs `handleReset()`.
 * The URL must be cleaned to exactly `/agency/reservations/new` (no
 * `reservation_id`) as the FIRST effective operation, so no later state
 * reset can block abandoning the ticket screen. This is asserted statically
 * against the page source, following the project's source-scan test pattern
 * (see tests/boarding/security-residue.test.ts).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const PAGE = 'app/agency/reservations/new/page.tsx';

const NAVIGATION = "router.replace('/agency/reservations/new')";

function handleResetBody(): string {
  const src = fs.readFileSync(path.join(REPO_ROOT, PAGE), 'utf8');
  const match = src.match(
    /const handleReset = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/,
  );
  if (!match) {
    throw new Error(
      `handleReset (useCallback) not found in ${PAGE} — has the handler changed shape?`,
    );
  }
  return match[1];
}

describe('reservation wizard — "Nueva reserva" reset navigation', () => {
  const body = handleResetBody();

  it('navigates to exactly /agency/reservations/new without reservation_id', () => {
    expect(body).toContain(NAVIGATION);
    expect(body).not.toMatch(/router\.replace\([^)]*reservation_id/);
    expect(body).not.toMatch(/router\.replace\([^)]*\?/);
  });

  it('cleans the URL as the first effective operation of handleReset', () => {
    const firstStatement = body.trimStart().split('\n')[0].trim();
    expect(firstStatement).toBe(`${NAVIGATION};`);
  });

  it('clears ticket state so the wizard can start again', () => {
    expect(body).toContain('setReservationIdFromUrl(null)');
    expect(body).toContain('setSuccessData(null)');
    expect(body).toContain('wizard.resetWizard();');
  });

  it('performs the navigation before the state resets', () => {
    const navigationIdx = body.indexOf(NAVIGATION);
    const ticketIdx = body.indexOf('setReservationIdFromUrl(null)');
    const wizardIdx = body.indexOf('wizard.resetWizard();');
    expect(navigationIdx).toBeGreaterThan(-1);
    expect(ticketIdx).toBeGreaterThan(navigationIdx);
    expect(wizardIdx).toBeGreaterThan(navigationIdx);
  });
});
