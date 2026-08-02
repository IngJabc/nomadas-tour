import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

export const ACTIVE_RLS_MIGRATION =
  'supabase/migrations/039_rls_identity_from_public_users_v2.sql';

const FORBIDDEN_IN_POLICIES = [
  /auth\.jwt\(\)\s*->\s*'user_metadata'/,
  /user_metadata\.role/,
  /user_metadata\.agency_id/,
  /'user_metadata'\s*->>\s*'role'/,
  /'user_metadata'\s*->>\s*'agency_id'/,
];

const REQUIRED_ROLE_HELPER = /private\.auth_app_role\(\)/;
const REQUIRED_AGENCY_HELPER = /private\.auth_app_agency_id\(\)/;

export interface RlsPolicyScanResult {
  policyCount: number;
  violations: string[];
  missingRoleHelper: string[];
  agencyPoliciesMissingAgencyHelper: string[];
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

export function extractCreatePolicyBlocks(sql: string): { name: string; body: string }[] {
  const cleaned = stripSqlComments(sql);
  const blocks: { name: string; body: string }[] = [];
  const regex = /CREATE\s+POLICY\s+"([^"]+)"[\s\S]*?;/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cleaned)) !== null) {
    blocks.push({ name: match[1], body: match[0] });
  }

  return blocks;
}

function isAgencyScopedPolicy(name: string, body: string): boolean {
  return (
    name.includes('agency') ||
    (body.includes("= 'agency'") && body.includes('agency_id'))
  );
}

export function scanActiveRlsMigration(
  migrationRelativePath: string = ACTIVE_RLS_MIGRATION,
): RlsPolicyScanResult {
  const absPath = path.join(REPO_ROOT, migrationRelativePath);
  const sql = fs.readFileSync(absPath, 'utf8');
  const policies = extractCreatePolicyBlocks(sql);

  const violations: string[] = [];
  const missingRoleHelper: string[] = [];
  const agencyPoliciesMissingAgencyHelper: string[] = [];

  for (const policy of policies) {
    for (const pattern of FORBIDDEN_IN_POLICIES) {
      if (pattern.test(policy.body)) {
        violations.push(`Policy "${policy.name}" matches forbidden pattern ${pattern}`);
      }
    }

    if (!REQUIRED_ROLE_HELPER.test(policy.body)) {
      missingRoleHelper.push(policy.name);
    }

    if (
      isAgencyScopedPolicy(policy.name, policy.body) &&
      !REQUIRED_AGENCY_HELPER.test(policy.body)
    ) {
      agencyPoliciesMissingAgencyHelper.push(policy.name);
    }
  }

  return {
    policyCount: policies.length,
    violations,
    missingRoleHelper,
    agencyPoliciesMissingAgencyHelper,
  };
}
