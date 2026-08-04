import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const {
  mockGetBranding,
  mockGetDashboard,
  mockUseAgencyBranding,
  mockUseAuthUser,
  mockPathname,
} = vi.hoisted(() => ({
  mockGetBranding: vi.fn(),
  mockGetDashboard: vi.fn(),
  mockUseAgencyBranding: vi.fn(),
  mockUseAuthUser: vi.fn(),
  mockPathname: vi.fn(() => '/agency'),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

vi.mock('@/lib/api', () => ({
  agencyApi: {
    getBranding: () => mockGetBranding(),
    getDashboard: () => mockGetDashboard(),
  },
}));

vi.mock('@/components/branding/AgencyBrandingProvider', () => ({
  useAgencyBranding: () => mockUseAgencyBranding(),
}));

vi.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}));

vi.mock('@/components/brand/PlatformLogoMark', () => ({
  PlatformLogoMark: () => (
    <span data-testid="platform-logo">Nómadas logo</span>
  ),
}));

import { AgencySidebar } from '@/components/layout/AgencySidebar';
import { AdminSidebar } from '@/components/layout/AdminSidebar';

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname.mockReturnValue('/agency');
  mockUseAgencyBranding.mockReturnValue({
    branding: null,
    loading: true,
    error: false,
  });
  mockUseAuthUser.mockReturnValue({
    user: null,
    loading: true,
  });
});

describe('AgencySidebar branding', () => {
  it('uses logo_url from branding and agency_name from auth context', () => {
    mockUseAgencyBranding.mockReturnValue({
      branding: {
        logo_url: 'https://cdn.example.com/agency-logo.png',
        primary_color: '#112233',
        secondary_color: '#445566',
        accent_color: '#778899',
      },
      loading: false,
      error: false,
    });
    mockUseAuthUser.mockReturnValue({
      user: {
        id: 'user-1',
        email: 'agency@example.com',
        role: 'agency',
        agency_id: 'agency-1',
        agency_name: 'Mi Agencia XYZ',
      },
      loading: false,
    });

    render(<AgencySidebar onLogout={vi.fn()} />);

    expect(screen.getByText('Mi Agencia XYZ')).toBeTruthy();
    const logo = screen.getByRole('img', {
      name: 'Logo de Mi Agencia XYZ',
    });
    expect(logo.getAttribute('src')).toBe(
      'https://cdn.example.com/agency-logo.png',
    );
    expect(screen.getByText('Panel Agencia')).toBeTruthy();
    expect(screen.queryByTestId('platform-logo')).toBeNull();
    expect(mockGetBranding).not.toHaveBeenCalled();
    expect(mockGetDashboard).not.toHaveBeenCalled();
  });

  it('keeps a stable fallback while auth identity is loading', () => {
    render(<AgencySidebar onLogout={vi.fn()} />);

    expect(screen.getByTestId('platform-logo')).toBeTruthy();
    expect(screen.getByText('Agencia')).toBeTruthy();
    expect(screen.getByText('Panel Agencia')).toBeTruthy();
    expect(mockGetBranding).not.toHaveBeenCalled();
    expect(mockGetDashboard).not.toHaveBeenCalled();
  });

  it('keeps admin on platform branding without tenant data', () => {
    mockPathname.mockReturnValue('/admin');

    render(<AdminSidebar onLogout={vi.fn()} />);

    expect(screen.getByTestId('platform-logo')).toBeTruthy();
    expect(screen.getByText('Panel Admin')).toBeTruthy();
    expect(mockGetDashboard).not.toHaveBeenCalled();
    expect(mockGetBranding).not.toHaveBeenCalled();
  });
});
