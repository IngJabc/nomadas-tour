import { describe, expect, it } from 'vitest';
import {
  AUDIT_UI_ALLOWED_SUPERADMIN_ID,
  canAccessAdminAuditUi,
} from '@/lib/audit-ui-gate';

describe('canAccessAdminAuditUi (TEMPORARY UI GATE)', () => {
  it('allows only the configured SUPERADMIN id', () => {
    expect(
      canAccessAdminAuditUi({
        id: AUDIT_UI_ALLOWED_SUPERADMIN_ID,
        role: 'superadmin',
      }),
    ).toBe(true);
  });

  it('denies other SUPERADMIN ids', () => {
    expect(
      canAccessAdminAuditUi({
        id: '00000000-0000-4000-8000-000000000099',
        role: 'superadmin',
      }),
    ).toBe(false);
  });

  it('denies agency and null', () => {
    expect(
      canAccessAdminAuditUi({
        id: AUDIT_UI_ALLOWED_SUPERADMIN_ID,
        role: 'agency',
      }),
    ).toBe(false);
    expect(canAccessAdminAuditUi(null)).toBe(false);
  });
});
