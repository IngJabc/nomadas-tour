import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { AUDIT_UI_ALLOWED_SUPERADMIN_ID } from '@/lib/audit-ui-gate';

const {
  mockAdminListAudit,
  mockAgencyListAudit,
  mockListAgencies,
  mockListRoutes,
  mockUseAuthUser,
} = vi.hoisted(() => ({
  mockAdminListAudit: vi.fn(),
  mockAgencyListAudit: vi.fn(),
  mockListAgencies: vi.fn(),
  mockListRoutes: vi.fn(),
  mockUseAuthUser: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  adminApi: {
    listAudit: (params?: unknown) => mockAdminListAudit(params),
    listAgencies: () => mockListAgencies(),
    listRoutes: () => mockListRoutes(),
  },
  agencyApi: {
    listAudit: (params?: unknown) => mockAgencyListAudit(params),
  },
}));

vi.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuthUser: () => mockUseAuthUser(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import AdminAuditPage from '@/app/admin/audit/page';
import AgencyAuditPage from '@/app/agency/audit/page';

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminListAudit.mockResolvedValue({ items: [], next_cursor: null });
  mockAgencyListAudit.mockResolvedValue({ items: [], next_cursor: null });
  mockListAgencies.mockResolvedValue([]);
  mockListRoutes.mockResolvedValue([]);
  mockUseAuthUser.mockReturnValue({
    user: {
      id: 'u1',
      email: 'a@example.com',
      role: 'agency',
      agency_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      agency_name: 'Agencia Central',
    },
    loading: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
  });
});

describe('AuditSecurity', () => {
  it('admin page uses adminApi.listAudit only', async () => {
    mockUseAuthUser.mockReturnValue({
      user: {
        id: AUDIT_UI_ALLOWED_SUPERADMIN_ID,
        email: 'admin@example.com',
        role: 'superadmin',
        agency_id: null,
        agency_name: null,
      },
      loading: false,
      refresh: vi.fn(),
      signOut: vi.fn(),
    });
    render(<AdminAuditPage />);
    await waitFor(() => {
      expect(mockAdminListAudit).toHaveBeenCalled();
    });
    expect(mockAgencyListAudit).not.toHaveBeenCalled();
    const params = mockAdminListAudit.mock.calls[0]?.[0] ?? {};
    expect(params).toHaveProperty('from');
    expect(params).toHaveProperty('to');
  });

  it('agency page uses agencyApi.listAudit and never sends agency_id', async () => {
    render(<AgencyAuditPage />);
    await waitFor(() => {
      expect(mockAgencyListAudit).toHaveBeenCalled();
    });
    expect(mockAdminListAudit).not.toHaveBeenCalled();
    expect(mockListAgencies).not.toHaveBeenCalled();
    expect(mockListRoutes).not.toHaveBeenCalled();
    for (const call of mockAgencyListAudit.mock.calls) {
      expect(call[0]).not.toHaveProperty('agency_id');
    }
  });
});
