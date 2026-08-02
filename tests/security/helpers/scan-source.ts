import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

const SCAN_ROOTS = [
  'app',
  'components',
  'hooks',
  'lib',
  'backend/src',
] as const;

const SCAN_FILES = ['middleware.ts'] as const;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** Temporary until accept-invitation metadata cleanup (post SEC-007). */
export const USER_METADATA_ALLOWLIST = new Set([
  'backend/src/services/auth.service.ts',
]);

const FORBIDDEN_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'user_metadata', regex: /user_metadata/ },
];

function normalizeRelative(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function shouldScanFile(relativePath: string): boolean {
  if (!/\.(ts|tsx|js|jsx)$/.test(relativePath)) return false;
  if (/\.test\.(ts|tsx)$/.test(relativePath)) return false;
  if (USER_METADATA_ALLOWLIST.has(relativePath)) return false;
  return true;
}

function walkDir(absDir: string, hits: string[]): void {
  if (!fs.existsSync(absDir)) return;

  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const absPath = path.join(absDir, entry.name);
    const relativePath = normalizeRelative(path.relative(REPO_ROOT, absPath));

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walkDir(absPath, hits);
      continue;
    }

    if (!shouldScanFile(relativePath)) continue;

    const ext = path.extname(entry.name);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;

    const content = fs.readFileSync(absPath, 'utf8');
    for (const { name, regex } of FORBIDDEN_PATTERNS) {
      if (regex.test(content)) {
        hits.push(`${relativePath} (matched: ${name})`);
      }
    }
  }
}

export function findForbiddenUserMetadataInSource(): string[] {
  const hits: string[] = [];

  for (const root of SCAN_ROOTS) {
    walkDir(path.join(REPO_ROOT, root), hits);
  }

  for (const file of SCAN_FILES) {
    const absPath = path.join(REPO_ROOT, file);
    if (!fs.existsSync(absPath)) continue;
    const relativePath = normalizeRelative(file);
    if (!shouldScanFile(relativePath)) continue;
    const content = fs.readFileSync(absPath, 'utf8');
    for (const { name, regex } of FORBIDDEN_PATTERNS) {
      if (regex.test(content)) {
        hits.push(`${relativePath} (matched: ${name})`);
      }
    }
  }

  return hits;
}
