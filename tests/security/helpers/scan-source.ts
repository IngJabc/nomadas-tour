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

export const FORBIDDEN_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'user_metadata', regex: /user_metadata/ },
  { name: 'raw_user_meta_data', regex: /raw_user_meta_data/ },
];

/** Auth admin/client metadata writes — role/agency_id must live in public.users only. */
export const FORBIDDEN_AUTH_WRITE_PATTERNS: { name: string; regex: RegExp }[] = [
  ...FORBIDDEN_PATTERNS,
  {
    name: 'updateUserById with user_metadata',
    regex: /updateUserById\s*\([^)]*\{[\s\S]*?user_metadata/s,
  },
  {
    name: 'createUser with user_metadata',
    regex: /createUser\s*\(\s*\{[\s\S]*?user_metadata/s,
  },
  {
    name: 'updateUser with data.role or data.agency_id',
    regex: /(?:auth\.)?updateUser\s*\(\s*\{[\s\S]*?data\s*:\s*\{[\s\S]*?(?:role|agency_id)/s,
  },
  {
    name: 'admin.updateUserById with data.role or data.agency_id',
    regex: /admin\.updateUserById\s*\([^)]*\{[\s\S]*?data\s*:\s*\{[\s\S]*?(?:role|agency_id)/s,
  },
];

function normalizeRelative(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function shouldScanFile(relativePath: string): boolean {
  if (!/\.(ts|tsx|js|jsx)$/.test(relativePath)) return false;
  if (/\.test\.(ts|tsx)$/.test(relativePath)) return false;
  return true;
}

function scanFileContent(
  relativePath: string,
  content: string,
  patterns: { name: string; regex: RegExp }[],
  hits: string[],
): void {
  for (const { name, regex } of patterns) {
    if (regex.test(content)) {
      hits.push(`${relativePath} (matched: ${name})`);
    }
  }
}

function walkDir(
  absDir: string,
  patterns: { name: string; regex: RegExp }[],
  hits: string[],
): void {
  if (!fs.existsSync(absDir)) return;

  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const absPath = path.join(absDir, entry.name);
    const relativePath = normalizeRelative(path.relative(REPO_ROOT, absPath));

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walkDir(absPath, patterns, hits);
      continue;
    }

    if (!shouldScanFile(relativePath)) continue;

    const ext = path.extname(entry.name);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;

    const content = fs.readFileSync(absPath, 'utf8');
    scanFileContent(relativePath, content, patterns, hits);
  }
}

function scanRoots(patterns: { name: string; regex: RegExp }[]): string[] {
  const hits: string[] = [];

  for (const root of SCAN_ROOTS) {
    walkDir(path.join(REPO_ROOT, root), patterns, hits);
  }

  for (const file of SCAN_FILES) {
    const absPath = path.join(REPO_ROOT, file);
    if (!fs.existsSync(absPath)) continue;
    const relativePath = normalizeRelative(file);
    if (!shouldScanFile(relativePath)) continue;
    const content = fs.readFileSync(absPath, 'utf8');
    scanFileContent(relativePath, content, patterns, hits);
  }

  return hits;
}

export function findForbiddenUserMetadataInSource(): string[] {
  return scanRoots(FORBIDDEN_PATTERNS);
}

export function findForbiddenAuthMetadataWrites(): string[] {
  return scanRoots(FORBIDDEN_AUTH_WRITE_PATTERNS);
}
