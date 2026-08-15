import type { AppUser } from '@/lib/auth/types';

/**
 * TEMPORARY UI GATE — Audit Trail
 *
 * Restricts visibility of `/admin/audit` (sidebar + page) to a single
 * SUPERADMIN user while the UI remains too technical for other admins.
 *
 * This controls frontend visibility/UX only. It does NOT replace API
 * authorization: `GET /api/admin/audit` remains SUPERADMIN-scoped in F5-002.
 * Remove this gate later without touching the backend read API.
 */
export const AUDIT_UI_ALLOWED_SUPERADMIN_ID =
  'd865a719-df4b-4677-8f94-e9bd2d5f5664';

export function canAccessAdminAuditUi(
  user: Pick<AppUser, 'id' | 'role'> | null | undefined,
): boolean {
  if (!user) return false;
  return (
    user.role === 'superadmin' &&
    user.id === AUDIT_UI_ALLOWED_SUPERADMIN_ID
  );
}
