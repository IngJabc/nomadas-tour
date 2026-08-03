import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockGetBranding, mockUpdateBranding } = vi.hoisted(() => ({
  mockGetBranding: vi.fn(),
  mockUpdateBranding: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  agencyApi: {
    getBranding: () => mockGetBranding(),
    updateBranding: (branding: unknown) => mockUpdateBranding(branding),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/brand/PlatformLogoMark', () => ({
  PlatformLogoMark: () => <span>Nómadas logo</span>,
}));

import {
  AgencyBrandingProvider,
  useAgencyBranding,
} from '@/components/branding/AgencyBrandingProvider';
import AgencyBrandingSettingsPage from '@/app/agency/settings/branding/page';

function ContextProbe() {
  const { branding, loading, error } = useAgencyBranding();
  return (
    <div
      data-testid="context"
      data-loading={String(loading)}
      data-error={String(error)}
      data-logo={branding?.logo_url ?? ''}
    />
  );
}

function RuntimeUpdateProbe({
  branding,
}: {
  branding: {
    logo_url: null;
    primary_color: string;
    secondary_color: string;
    accent_color: string;
  };
}) {
  const { updateBranding } = useAgencyBranding();
  return (
    <button type="button" onClick={() => updateBranding(branding)}>
      Apply runtime branding
    </button>
  );
}

describe('AgencyBrandingProvider', () => {
  it('applies tenant colors and derived variables to its scope', async () => {
    mockGetBranding.mockResolvedValue({
      logo_url: 'https://cdn.example.com/logo.png',
      primary_color: '#112233',
      secondary_color: '#445566',
      accent_color: '#778899',
    });

    const { container } = render(
      <AgencyBrandingProvider>
        <div>Agency content</div>
      </AgencyBrandingProvider>,
    );

    const scope = container.querySelector(
      '[data-agency-branding-scope]',
    ) as HTMLElement;

    await waitFor(() => {
      expect(scope.style.getPropertyValue('--color-brand-navy')).toBe(
        '#112233',
      );
    });

    expect(scope.style.getPropertyValue('--color-brand-blue')).toBe('#445566');
    expect(scope.style.getPropertyValue('--color-brand-cyan')).toBe('#778899');
    expect(scope.style.getPropertyValue('--color-brand-dark')).toContain(
      'color-mix',
    );
    expect(scope.style.getPropertyValue('--color-brand-mid')).toContain(
      'color-mix',
    );
    expect(scope.style.getPropertyValue('--color-cyan-bg')).toContain(
      'color-mix',
    );
    expect(scope.style.getPropertyValue('--color-brand-blue-bg')).toContain(
      'color-mix',
    );
  });

  it('handles missing logo and colors without overriding platform defaults', async () => {
    mockGetBranding.mockResolvedValue({
      logo_url: null,
    });

    const { container } = render(
      <AgencyBrandingProvider>
        <ContextProbe />
      </AgencyBrandingProvider>,
    );
    const scope = container.querySelector(
      '[data-agency-branding-scope]',
    ) as HTMLElement;

    await waitFor(() => {
      expect(screen.getByTestId('context').dataset.loading).toBe('false');
    });

    expect(screen.getByTestId('context').dataset.logo).toBe('');
    expect(scope.style.getPropertyValue('--color-brand-navy')).toBe('');
    expect(scope.style.getPropertyValue('--color-brand-blue')).toBe('');
    expect(scope.style.getPropertyValue('--color-brand-cyan')).toBe('');
  });

  it('keeps platform defaults when the branding request fails', async () => {
    mockGetBranding.mockRejectedValue(new Error('network failure'));

    const { container } = render(
      <AgencyBrandingProvider>
        <ContextProbe />
      </AgencyBrandingProvider>,
    );
    const scope = container.querySelector(
      '[data-agency-branding-scope]',
    ) as HTMLElement;

    await waitFor(() => {
      expect(screen.getByTestId('context').dataset.error).toBe('true');
    });

    expect(scope.getAttribute('style')).toBeNull();
  });

  it('does not apply agency variables to an admin sibling outside its scope', async () => {
    mockGetBranding.mockResolvedValue({
      logo_url: null,
      primary_color: '#112233',
      secondary_color: '#445566',
      accent_color: '#778899',
    });

    const { container } = render(
      <>
        <div data-testid="admin-scope">Admin content</div>
        <AgencyBrandingProvider>
          <div>Agency content</div>
        </AgencyBrandingProvider>
      </>,
    );

    const agencyScope = container.querySelector(
      '[data-agency-branding-scope]',
    ) as HTMLElement;
    await waitFor(() => {
      expect(agencyScope.style.getPropertyValue('--color-brand-navy')).toBe(
        '#112233',
      );
    });

    expect(
      screen
        .getByTestId('admin-scope')
        .style.getPropertyValue('--color-brand-navy'),
    ).toBe('');
  });

  it('updates scoped variables after Settings saves without remounting', async () => {
    const initialBranding = {
      logo_url: null,
      primary_color: '#000024',
      secondary_color: '#0080FF',
      accent_color: '#00D4FF',
    };
    const updatedBranding = {
      ...initialBranding,
      accent_color: '#AA00CC',
    };
    mockGetBranding.mockResolvedValue(initialBranding);
    mockUpdateBranding.mockResolvedValue(updatedBranding);

    const { container } = render(
      <AgencyBrandingProvider>
        <AgencyBrandingSettingsPage />
      </AgencyBrandingProvider>,
    );
    const scope = container.querySelector(
      '[data-agency-branding-scope]',
    ) as HTMLElement;

    await waitFor(() => {
      expect(scope.style.getPropertyValue('--color-brand-cyan')).toBe(
        '#00D4FF',
      );
    });

    const accentInput = await screen.findByLabelText('Color de acento');
    fireEvent.change(accentInput, { target: { value: '#AA00CC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => {
      expect(scope.style.getPropertyValue('--color-brand-cyan')).toBe(
        '#AA00CC',
      );
    });
    expect(scope.style.getPropertyValue('--color-cyan-bg')).toContain(
      'color-mix',
    );
    expect(
      container.querySelector('[data-agency-branding-scope]'),
    ).toBe(scope);
  });

  it('does not let a stale initial request overwrite a runtime update', async () => {
    let resolveInitialBranding!: (value: {
      logo_url: null;
      primary_color: string;
      secondary_color: string;
      accent_color: string;
    }) => void;
    mockGetBranding.mockReturnValue(
      new Promise((resolve) => {
        resolveInitialBranding = resolve;
      }),
    );
    const runtimeBranding = {
      logo_url: null,
      primary_color: '#123456',
      secondary_color: '#654321',
      accent_color: '#ABCDEF',
    };

    const { container } = render(
      <AgencyBrandingProvider>
        <RuntimeUpdateProbe branding={runtimeBranding} />
      </AgencyBrandingProvider>,
    );
    const scope = container.querySelector(
      '[data-agency-branding-scope]',
    ) as HTMLElement;

    fireEvent.click(
      screen.getByRole('button', { name: 'Apply runtime branding' }),
    );
    expect(scope.style.getPropertyValue('--color-brand-cyan')).toBe('#ABCDEF');

    await act(async () => {
      resolveInitialBranding({
        logo_url: null,
        primary_color: '#000024',
        secondary_color: '#0080FF',
        accent_color: '#00D4FF',
      });
      await Promise.resolve();
    });

    expect(scope.style.getPropertyValue('--color-brand-cyan')).toBe('#ABCDEF');
    expect(scope.style.getPropertyValue('--color-brand-blue')).toBe('#654321');
    expect(scope.style.getPropertyValue('--color-brand-navy')).toBe('#123456');
  });
});
