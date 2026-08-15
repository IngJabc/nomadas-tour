import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import {
  AUDIT_UI_ALLOWED_SUPERADMIN_ID,
} from '@/lib/audit-ui-gate';

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

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/components/brand/PlatformLogoMark', () => ({
  PlatformLogoMark: () => <span data-testid="logo" />,
}));

import AdminAuditPage from '@/app/admin/audit/page';
import AgencyAuditPage from '@/app/agency/audit/page';
import { AdminSidebar } from '@/components/layout/AdminSidebar';

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminListAudit.mockResolvedValue({ items: [], next_cursor: null });
  mockAgencyListAudit.mockResolvedValue({ items: [], next_cursor: null });
  mockListAgencies.mockResolvedValue([]);
  mockListRoutes.mockResolvedValue([]);
});

function authUser(partial: {
  id: string;
  role: 'superadmin' | 'agency';
  agency_name?: string | null;
}) {
  return {
    user: {
      id: partial.id,
      email: 'x@example.com',
      role: partial.role,
      agency_id:
        partial.role === 'agency'
          ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
          : null,
      agency_name: partial.agency_name ?? null,
    },
    loading: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
  };
}

describe('TEMPORARY UI GATE — AdminSidebar', () => {
  it('shows Auditoría for the allowed SUPERADMIN', () => {
    mockUseAuthUser.mockReturnValue(
      authUser({ id: AUDIT_UI_ALLOWED_SUPERADMIN_ID, role: 'superadmin' }),
    );
    render(<AdminSidebar onLogout={vi.fn()} />);
    expect(screen.getByText('Auditoría')).toBeTruthy();
  });

  it('hides Auditoría for other SUPERADMINs', () => {
    mockUseAuthUser.mockReturnValue(
      authUser({
        id: '00000000-0000-4000-8000-000000000099',
        role: 'superadmin',
      }),
    );
    render(<AdminSidebar onLogout={vi.fn()} />);
    expect(screen.queryByText('Auditoría')).toBeNull();
  });
});

describe('TEMPORARY UI GATE — /admin/audit', () => {
  it('renders AuditFeed and fetches for the allowed user', async () => {
    mockUseAuthUser.mockReturnValue(
      authUser({ id: AUDIT_UI_ALLOWED_SUPERADMIN_ID, role: 'superadmin' }),
    );
    render(<AdminAuditPage />);
    await waitFor(() => {
      expect(mockAdminListAudit).toHaveBeenCalled();
    });
    expect(screen.getByText('Auditoría')).toBeTruthy();
  });

  it('does not render AuditFeed or call listAudit for other SUPERADMINs', async () => {
    mockUseAuthUser.mockReturnValue(
      authUser({
        id: '00000000-0000-4000-8000-000000000099',
        role: 'superadmin',
      }),
    );
    const { container } = render(<AdminAuditPage />);
    expect(container.firstChild).toBeNull();
    expect(mockAdminListAudit).not.toHaveBeenCalled();
    expect(mockListAgencies).not.toHaveBeenCalled();
    expect(mockListRoutes).not.toHaveBeenCalled();
  });
});

describe('TEMPORARY UI GATE — agency unchanged', () => {
  it('agency audit page still loads via agencyApi', async () => {
    mockUseAuthUser.mockReturnValue(
      authUser({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        role: 'agency',
        agency_name: 'Agencia Central',
      }),
    );
    render(<AgencyAuditPage />);
    await waitFor(() => {
      expect(mockAgencyListAudit).toHaveBeenCalled();
    });
    expect(mockAdminListAudit).not.toHaveBeenCalled();
  });
});
