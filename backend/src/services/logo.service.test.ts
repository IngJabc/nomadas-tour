import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../errors/index.js';

const mockUpload = vi.fn();
const mockRemove = vi.fn();
const mockGetPublicUrl = vi.fn();
const mockStorageFrom = vi.fn((_bucket: string) => ({
  upload: mockUpload,
  remove: mockRemove,
  getPublicUrl: mockGetPublicUrl,
}));

vi.mock('../config/database.js', () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => mockStorageFrom(bucket),
    },
  },
}));

import {
  AGENCY_ASSETS_BUCKET,
  logoService,
  validateLogoFile,
} from './logo.service.js';

const PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

beforeEach(() => {
  vi.clearAllMocks();
  mockUpload.mockResolvedValue({ error: null });
  mockRemove.mockResolvedValue({ error: null });
  mockGetPublicUrl.mockReturnValue({
    data: {
      publicUrl:
        'https://project.supabase.co/storage/v1/object/public/agency-assets/agency-1/logo.png',
    },
  });
  vi.spyOn(Date, 'now').mockReturnValue(1720000000000);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LogoService', () => {
  it('uploads with the authenticated agency path and cleans old extensions', async () => {
    const result = await logoService.uploadAgencyLogo({
      agencyId: 'agency-1',
      buffer: PNG_BUFFER,
      originalName: '../../agency-2/logo.png',
      mimeType: 'image/png',
    });

    expect(mockStorageFrom).toHaveBeenCalledWith(AGENCY_ASSETS_BUCKET);
    expect(mockUpload).toHaveBeenCalledWith(
      'agency-1/logo.png',
      PNG_BUFFER,
      {
        contentType: 'image/png',
        upsert: true,
      },
    );
    expect(mockRemove).toHaveBeenCalledWith([
      'agency-1/logo.jpg',
      'agency-1/logo.webp',
    ]);
    expect(result).toBe(
      'https://project.supabase.co/storage/v1/object/public/agency-assets/agency-1/logo.png?v=1720000000000',
    );
  });

  it('rejects SVG files before accessing storage', () => {
    expect(() =>
      validateLogoFile({
        buffer: Buffer.from('<svg></svg>'),
        originalName: 'logo.svg',
        mimeType: 'image/svg+xml',
      }),
    ).toThrow(ValidationError);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('rejects files whose MIME does not match their extension', () => {
    expect(() =>
      validateLogoFile({
        buffer: PNG_BUFFER,
        originalName: 'logo.png',
        mimeType: 'image/jpeg',
      }),
    ).toThrow('La extensión y el tipo MIME del logo no coinciden');
  });

  it('rejects files with forged image content', () => {
    expect(() =>
      validateLogoFile({
        buffer: Buffer.from('not a png'),
        originalName: 'logo.png',
        mimeType: 'image/png',
      }),
    ).toThrow('El contenido del archivo de logo no es válido');
  });
});
