/**
 * @vitest-environment node
 *
 * AUD-020 P3 — Scanner consumers (post-legacy cleanup).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function walkSourceFiles(relativeDir: string): string[] {
  const absDir = path.join(REPO_ROOT, relativeDir);
  if (!fs.existsSync(absDir)) return [];

  const files: string[] = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...walkSourceFiles(rel));
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    files.push(rel);
  }
  return files;
}

describe('AUD-020 P3 — scanner consumers', () => {
  it('scanner page calls lookupPassengerByQR and toggleBoarding', () => {
    const scanPage = read('app/agency/scan/page.tsx');

    expect(scanPage).toContain('agencyApi.lookupPassengerByQR');
    expect(scanPage).toContain('agencyApi.toggleBoarding');
    expect(scanPage).toContain('getBoardingOperatorMessage');
    expect(scanPage).toContain('getLookupFailureOperatorMessage');
    expect(scanPage).toContain('response.allowed');
    expect(scanPage).toContain('changed=false');
    expect(scanPage).toContain(
      'Ingresa código de ticket de 8 caracteres o QR completo',
    );
    expect(scanPage).not.toContain('results.length');
    expect(scanPage).not.toContain('results[0]');
    expect(scanPage).not.toContain('fragmento');
    expect(scanPage).not.toContain('booker_document');
    expect(scanPage).not.toContain('passenger.document');
  });

  it('lib/api exposes typed boarding methods and no boardPassenger', () => {
    const api = read('lib/api.ts');

    expect(api).toContain('lookupPassengerByQR:');
    expect(api).toContain('toggleBoarding:');
    expect(api).toContain('BoardingLookupDTO');
    expect(api).toContain('BoardingLookupResponse');
    expect(api).toContain('BoardingToggleResult');
    expect(api).toContain('/agency/boarding/');
    expect(api).not.toContain('Promise<BoardingLookupDTO[]>');
    expect(api).not.toContain('boardPassenger');
    expect(api).not.toContain('/agency/reservations/board');
  });

  it('has no callers of boardPassenger or legacy scanner routes', () => {
    const roots = ['app', 'components', 'hooks', 'lib'];
    const hits: string[] = [];

    for (const root of roots) {
      for (const file of walkSourceFiles(root)) {
        const content = read(file);
        if (
          /boardPassenger/.test(content) ||
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
});
