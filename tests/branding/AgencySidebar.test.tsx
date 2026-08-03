import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const {
  mockGetBranding,
  mockGetDashboard,
  mockUseAgencyBranding,
  mockPathname,
} = vi.hoisted(() => ({
  mockGetBranding: vi.fn(),
  mockGetDashboard: vi.fn(),
  mockUseAgencyBranding: vi.fn(),
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
});

describe('AgencySidebar branding', () => {
  it('uses logo_url from the branding context and agencies.name from the existing dashboard endpoint', async () => {
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
    mockGetDashboard.mockResolvedValue({ agency_name: 'Mi Agencia XYZ' });

    render(<AgencySidebar onLogout={vi.fn()} />);

    expect(await screen.findByText('Mi Agencia XYZ')).toBeTruthy();
    const logo = screen.getByRole('img', {
      name: 'Logo de Mi Agencia XYZ',
    });
    expect(logo.getAttribute('src')).toBe(
      'https://cdn.example.com/agency-logo.png',
    );
    expect(screen.getByText('Panel Agencia')).toBeTruthy();
    expect(screen.queryByTestId('platform-logo')).toBeNull();
    expect(mockGetBranding).not.toHaveBeenCalled();
  });

  it('keeps the platform logo and stable agency fallback while data is unavailable', async () => {
    mockGetDashboard.mockRejectedValue(new Error('network failure'));

    render(<AgencySidebar onLogout={vi.fn()} />);

    await waitFor(() => {
      expect(mockGetDashboard).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('platform-logo')).toBeTruthy();
    expect(screen.getByText('Agencia')).toBeTruthy();
    expect(screen.getByText('Panel Agencia')).toBeTruthy();
    expect(mockGetBranding).not.toHaveBeenCalled();
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
