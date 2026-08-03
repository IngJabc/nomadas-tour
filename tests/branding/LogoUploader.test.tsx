import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  mockUploadLogo,
  mockUpdateBranding,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockUploadLogo: vi.fn(),
  mockUpdateBranding: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  agencyApi: {
    uploadLogo: (file: File) => mockUploadLogo(file),
    updateBranding: (patch: unknown) => mockUpdateBranding(patch),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('@/components/brand/PlatformLogoMark', () => ({
  PlatformLogoMark: () => <span>Nómadas logo</span>,
}));

import {
  LogoUploader,
  MAX_LOGO_FILE_BYTES,
} from '@/components/agency/LogoUploader';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LogoUploader', () => {
  it('rejects unsupported file types before upload', () => {
    render(
      <LogoUploader
        currentLogoUrl={null}
        onBrandingUpdated={vi.fn()}
      />,
    );
    const file = new File(['<svg />'], 'logo.svg', {
      type: 'image/svg+xml',
    });

    fireEvent.change(screen.getByLabelText('Seleccionar logo'), {
      target: { files: [file] },
    });

    expect(mockUploadLogo).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      'Selecciona una imagen PNG, JPEG o WEBP',
    );
  });

  it('rejects files larger than 1MB before upload', () => {
    render(
      <LogoUploader
        currentLogoUrl={null}
        onBrandingUpdated={vi.fn()}
      />,
    );
    const file = new File(
      [new Uint8Array(MAX_LOGO_FILE_BYTES + 1)],
      'logo.png',
      { type: 'image/png' },
    );

    fireEvent.change(screen.getByLabelText('Seleccionar logo'), {
      target: { files: [file] },
    });

    expect(mockUploadLogo).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      'El logo no puede superar 1MB',
    );
  });

  it('returns the persisted branding after a successful upload', async () => {
    const updated = {
      logo_url:
        'https://project.supabase.co/storage/v1/object/public/agency-assets/agency-1/logo.webp?v=1',
      primary_color: '#000024',
      secondary_color: '#0080FF',
      accent_color: '#00D4FF',
    };
    const onBrandingUpdated = vi.fn();
    mockUploadLogo.mockResolvedValue(updated);
    render(
      <LogoUploader
        currentLogoUrl={null}
        onBrandingUpdated={onBrandingUpdated}
      />,
    );
    const file = new File(['webp'], 'logo.webp', { type: 'image/webp' });

    fireEvent.change(screen.getByLabelText('Seleccionar logo'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(mockUploadLogo).toHaveBeenCalledWith(file);
      expect(onBrandingUpdated).toHaveBeenCalledWith(updated);
    });
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Logo actualizado correctamente',
    );
  });
});
