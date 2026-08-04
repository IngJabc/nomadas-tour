import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AppUser } from '@/lib/auth/types';

const mockReplace = vi.fn();
const mockUseAuthUser = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuthUser: () => mockUseAuthUser(),
}));

import { AuthRoleGuard } from '@/components/auth/AuthRoleGuard';

const AGENCY_USER: AppUser = {
  id: 'user-1',
  email: 'agent@example.com',
  role: 'agency',
  agency_id: 'agency-1',
  agency_name: 'Agencia Demo',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AUD-019.3 — AuthRoleGuard keeps content during revalidation', () => {
  it('renders children when user has correct role even while loading', () => {
    mockUseAuthUser.mockReturnValue({
      user: AGENCY_USER,
      loading: true,
      refresh: vi.fn(),
      signOut: vi.fn(),
    });

    render(
      <AuthRoleGuard requiredRole="agency">
        <div data-testid="agency-panel">Agency panel</div>
      </AuthRoleGuard>,
    );

    expect(screen.getByTestId('agency-panel')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('returns null when loading with no user (first paint stays empty)', () => {
    mockUseAuthUser.mockReturnValue({
      user: null,
      loading: true,
      refresh: vi.fn(),
      signOut: vi.fn(),
    });

    const { container } = render(
      <AuthRoleGuard requiredRole="agency">
        <div data-testid="agency-panel">Agency panel</div>
      </AuthRoleGuard>,
    );

    expect(container.querySelector('[data-testid="agency-panel"]')).toBeNull();
  });

  it('keeps redirect when role does not match', () => {
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
});
