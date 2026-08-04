import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AppUser } from '@/lib/auth/types';

const mockReplace = vi.fn();
const mockUseAuthUser = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuthUser: () => mockUseAuthUser(),
}));

import { AuthNav } from '@/components/ui/AuthNav';
import { AuthRoleGuard } from '@/components/auth/AuthRoleGuard';

const AGENCY_USER: AppUser = {
  id: 'user-1',
  email: 'agent@example.com',
  role: 'agency',
  agency_id: 'agency-1',
  agency_name: 'Agencia Demo',
};

const SUPERADMIN_USER: AppUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'superadmin',
  agency_id: null,
  agency_name: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SEC-007 — identity forgery (frontend contract)', () => {
  describe('AuthProvider/useAuthUser → user.role (resolved identity, not JWT metadata)', () => {
    it('AuthNav does not show Admin when useAuthUser returns agency role', () => {
      mockUseAuthUser.mockReturnValue({
        user: AGENCY_USER,
        loading: false,
        refresh: vi.fn(),
        signOut: vi.fn(),
      });

      render(<AuthNav />);

      expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeTruthy();
    });

    it('AuthNav shows Admin when useAuthUser returns superadmin (positive control)', () => {
      mockUseAuthUser.mockReturnValue({
        user: SUPERADMIN_USER,
        loading: false,
        refresh: vi.fn(),
        signOut: vi.fn(),
      });

      render(<AuthNav />);

      expect(screen.getByRole('link', { name: 'Admin' })).toBeTruthy();
    });
  });

  describe('AuthRoleGuard consumes resolved role from useAuthUser', () => {
    it('redirects agency user away from superadmin-only content', () => {
      mockUseAuthUser.mockReturnValue({
        user: AGENCY_USER,
        loading: false,
        refresh: vi.fn(),
        signOut: vi.fn(),
      });

      const { container } = render(
        <AuthRoleGuard requiredRole="superadmin">
          <div data-testid="admin-panel">Admin panel</div>
        </AuthRoleGuard>,
      );

      expect(mockReplace).toHaveBeenCalledWith('/');
      expect(container.querySelector('[data-testid="admin-panel"]')).toBeNull();
    });

    it('renders children when resolved role matches requiredRole', () => {
      mockUseAuthUser.mockReturnValue({
        user: SUPERADMIN_USER,
        loading: false,
        refresh: vi.fn(),
        signOut: vi.fn(),
      });

      render(
        <AuthRoleGuard requiredRole="superadmin">
          <div data-testid="admin-panel">Admin panel</div>
        </AuthRoleGuard>,
      );

      expect(screen.getByTestId('admin-panel')).toBeTruthy();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });
});
