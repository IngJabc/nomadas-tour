import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  mockGetBranding,
  mockUpdateBranding,
  mockUploadLogo,
  mockRuntimeUpdate,
  mockRefreshBranding,
  mockUseAgencyBranding,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockGetBranding: vi.fn(),
  mockUpdateBranding: vi.fn(),
  mockUploadLogo: vi.fn(),
  mockRuntimeUpdate: vi.fn(),
  mockRefreshBranding: vi.fn(),
  mockUseAgencyBranding: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('@/components/branding/AgencyBrandingProvider', async () => {
  const actual = await vi.importActual<
    typeof import('@/components/branding/AgencyBrandingProvider')
  >('@/components/branding/AgencyBrandingProvider');

  return {
    ...actual,
    useAgencyBranding: () => mockUseAgencyBranding(),
  };
});

vi.mock('@/lib/api', () => ({
  agencyApi: {
    getBranding: () => mockGetBranding(),
    updateBranding: (patch: unknown) => mockUpdateBranding(patch),
    uploadLogo: (file: File) => mockUploadLogo(file),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('@/components/brand/PlatformLogoMark', () => ({
  PlatformLogoMark: () => (
    <span data-testid="platform-logo">Nómadas logo</span>
  ),
}));

import AgencyBrandingSettingsPage, {
  NOMADAS_BRANDING_DEFAULTS,
} from '@/app/agency/settings/branding/page';

const STORED_BRANDING = {
  logo_url: 'https://cdn.example.com/logo.png',
  primary_color: '#112233',
  secondary_color: '#445566',
  accent_color: '#778899',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAgencyBranding.mockReturnValue({
    branding: STORED_BRANDING,
    loading: false,
    error: false,
    updateBranding: mockRuntimeUpdate,
    refresh: mockRefreshBranding,
  });
});

describe('AgencyBrandingSettingsPage', () => {
  it('uses existing branding from the provider without another GET', async () => {
    render(<AgencyBrandingSettingsPage />);

    const logo = await screen.findByAltText('Logo actual de la agencia');
    expect(logo).toHaveProperty(
      'src',
      'https://cdn.example.com/logo.png',
    );
    expect(screen.getByLabelText('Color primario')).toHaveProperty(
      'value',
      '#112233',
    );
    expect(screen.getByLabelText('Color secundario')).toHaveProperty(
      'value',
      '#445566',
    );
    expect(screen.getByLabelText('Color de acento')).toHaveProperty(
      'value',
      '#778899',
    );
    expect(mockGetBranding).not.toHaveBeenCalled();
  });

  it('uses Nómadas defaults when the provider has no branding', async () => {
    mockUseAgencyBranding.mockReturnValue({
      branding: null,
      loading: false,
      error: false,
      updateBranding: mockRuntimeUpdate,
      refresh: mockRefreshBranding,
    });

    render(<AgencyBrandingSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Color primario')).toHaveProperty(
        'value',
        NOMADAS_BRANDING_DEFAULTS.primary_color,
      );
    });
    expect(screen.getAllByTestId('platform-logo')).toHaveLength(2);
    expect(screen.queryByText('No se pudo cargar el branding.')).toBeNull();
    expect(mockGetBranding).not.toHaveBeenCalled();
  });

  it('sends only branding fields in the update payload', async () => {
    mockUpdateBranding.mockImplementation(async (patch) => ({
      ...STORED_BRANDING,
      ...patch,
    }));

    render(<AgencyBrandingSettingsPage />);

    const accentInput = await screen.findByLabelText('Color de acento');
    fireEvent.change(accentInput, { target: { value: '#ABCDEF' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => {
      expect(mockUpdateBranding).toHaveBeenCalledWith({
        primary_color: '#112233',
        secondary_color: '#445566',
        accent_color: '#ABCDEF',
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Branding actualizado correctamente',
    );
    expect(mockRuntimeUpdate).toHaveBeenCalledWith({
      logo_url: 'https://cdn.example.com/logo.png',
      primary_color: '#112233',
      secondary_color: '#445566',
      accent_color: '#ABCDEF',
    });
  });

  it('restores Nómadas colors locally without saving', async () => {
    render(<AgencyBrandingSettingsPage />);

    await screen.findByLabelText('Color primario');
    fireEvent.click(
      screen.getByRole('button', { name: 'Restaurar colores Nómadas' }),
    );

    expect(screen.getByLabelText('Color primario')).toHaveProperty(
      'value',
      NOMADAS_BRANDING_DEFAULTS.primary_color,
    );
    expect(screen.getByLabelText('Color secundario')).toHaveProperty(
      'value',
      NOMADAS_BRANDING_DEFAULTS.secondary_color,
    );
    expect(screen.getByLabelText('Color de acento')).toHaveProperty(
      'value',
      NOMADAS_BRANDING_DEFAULTS.accent_color,
    );
    expect(mockUpdateBranding).not.toHaveBeenCalled();
  });

  it('shows toast feedback when the update API fails', async () => {
    mockUpdateBranding.mockRejectedValue(new Error('network failure'));

    render(<AgencyBrandingSettingsPage />);

    await screen.findByLabelText('Color primario');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'No se pudo guardar el branding',
      );
    });
    expect(mockRuntimeUpdate).not.toHaveBeenCalled();
  });

  it('updates runtime branding after a successful logo upload', async () => {
    const uploadedBranding = {
      ...STORED_BRANDING,
      logo_url:
        'https://project.supabase.co/storage/v1/object/public/agency-assets/agency-1/logo.png?v=1',
    };
    mockUploadLogo.mockResolvedValue(uploadedBranding);

    render(<AgencyBrandingSettingsPage />);

    const input = await screen.findByLabelText('Seleccionar logo');
    const file = new File(['png'], 'logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockUploadLogo).toHaveBeenCalledWith(file);
      expect(mockRuntimeUpdate).toHaveBeenCalledWith(uploadedBranding);
    });
  });

  it('uses provider refresh when retrying a branding load error', () => {
    mockUseAgencyBranding.mockReturnValue({
      branding: null,
      loading: false,
      error: true,
      updateBranding: mockRuntimeUpdate,
      refresh: mockRefreshBranding,
    });

    render(<AgencyBrandingSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(mockRefreshBranding).toHaveBeenCalledTimes(1);
    expect(mockGetBranding).not.toHaveBeenCalled();
  });
});
