/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

describe('SEC-C1 — backend/dist must not ship stale compiled auth', () => {
  it('.gitignore excludes backend/dist/', () => {
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/backend\/dist\/?/);
  });

  it('compiled auth.service.js has no user_metadata when dist exists locally', () => {
    const distAuth = path.join(REPO_ROOT, 'backend/dist/services/auth.service.js');
    if (!fs.existsSync(distAuth)) return;

    const content = fs.readFileSync(distAuth, 'utf8');
    expect(content).not.toMatch(/user_metadata/);
  });
});
