import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { Readable } from 'node:stream';
import { ValidationError } from '../errors/index.js';

const mockGetBranding = vi.fn();
const mockUpdateBranding = vi.fn();
const mockUploadAgencyLogo = vi.fn();
const mockUploadAgencyCover = vi.fn();
const mockRemoveAgencyCover = vi.fn();

vi.mock('../services/agency-settings.service.js', () => ({
  agencySettingsService: {
    getBranding: (...args: unknown[]) => mockGetBranding(...args),
    updateBranding: (...args: unknown[]) => mockUpdateBranding(...args),
  },
}));

vi.mock('../services/logo.service.js', () => ({
  MAX_LOGO_BYTES: 1024 * 1024,
  MAX_COVER_BYTES: 1024 * 1024,
  logoService: {
    uploadAgencyLogo: (...args: unknown[]) => mockUploadAgencyLogo(...args),
    uploadAgencyCover: (...args: unknown[]) => mockUploadAgencyCover(...args),
    removeAgencyCover: (...args: unknown[]) => mockRemoveAgencyCover(...args),
  },
}));

import { agencySettingsController } from './agency-settings.controller.js';

const BRANDING = {
  logo_url: 'https://cdn.example.com/agency-logo.png',
  primary_color: '#000024',
  secondary_color: '#0080FF',
  accent_color: '#00D4FF',
  cover_url: null,
  description: null,
  slogan: null,
};

function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    ctx: { agencyId: 'agency-1', userId: 'user-1', role: 'agency' },
    headers: { authorization: 'Bearer verified-user-token' },
    body,
    ip: '127.0.0.1',
    get: (name: string) =>
      name.toLowerCase() === 'user-agent' ? 'vitest' : undefined,
  } as unknown as Request;
  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn() as NextFunction;

  return { req, res, next, json };
}

function createMultipartReqRes({
  includeAgencyField = false,
  fieldName = 'logo',
}: {
  includeAgencyField?: boolean;
  fieldName?: 'logo' | 'cover';
} = {}) {
  const boundary = '----nomadas-test-boundary';
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ]);
  const parts: Buffer[] = [];

  if (includeAgencyField) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="agency_id"\r\n\r\nagency-2\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fieldName}.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );

  const req = Readable.from(Buffer.concat(parts)) as unknown as Request;
  Object.assign(req, {
    ctx: { agencyId: 'agency-1', userId: 'user-1', role: 'agency' },
    headers: {
      authorization: 'Bearer verified-user-token',
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    ip: '127.0.0.1',
    get: (name: string) =>
      name.toLowerCase() === 'user-agent' ? 'vitest' : undefined,
  });
  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn() as NextFunction;

  return { req, res, next, json, png };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AgencySettingsController.getBranding', () => {
  it('reads branding only for the authenticated agency context', async () => {
    mockGetBranding.mockResolvedValue(BRANDING);
    const { req, res, next, json } = createMockReqRes();

    await agencySettingsController.getBranding(req, res, next);

    expect(mockGetBranding).toHaveBeenCalledWith(
      'agency-1',
      'verified-user-token',
    );
    expect(json).toHaveBeenCalledWith(BRANDING);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('AgencySettingsController.updateBranding', () => {
  it('cannot target another agency through the request body', async () => {
    const { req, res, next } = createMockReqRes({
      agency_id: 'agency-2',
      accent_color: '#123456',
    });

    await agencySettingsController.updateBranding(req, res, next);

    expect(mockUpdateBranding).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('rejects invalid colors', async () => {
    const { req, res, next } = createMockReqRes({
      primary_color: '#12345G',
    });

    await agencySettingsController.updateBranding(req, res, next);

    expect(mockUpdateBranding).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('rejects an invalid logo URL', async () => {
    const { req, res, next } = createMockReqRes({
      logo_url: 'not-a-url',
    });

    await agencySettingsController.updateBranding(req, res, next);

    expect(mockUpdateBranding).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('updates only allowed branding fields for the agency context', async () => {
    mockUpdateBranding.mockResolvedValue({
      ...BRANDING,
      logo_url: null,
      accent_color: '#ABCDEF',
    });
    const { req, res, next, json } = createMockReqRes({
      logo_url: null,
      accent_color: '#ABCDEF',
    });

    await agencySettingsController.updateBranding(req, res, next);

    expect(mockUpdateBranding).toHaveBeenCalledWith(
      'agency-1',
      'user-1',
      {
        logo_url: null,
        accent_color: '#ABCDEF',
      },
      expect.objectContaining({ source: 'api' }),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        logo_url: null,
        accent_color: '#ABCDEF',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('trims and forwards the storefront presentation fields', async () => {
    mockUpdateBranding.mockResolvedValue({
      ...BRANDING,
      description: 'Viajes seguros',
      slogan: 'Viaja seguro',
    });
    const { req, res, next, json } = createMockReqRes({
      description: '  Viajes seguros  ',
      slogan: 'Viaja seguro',
    });

    await agencySettingsController.updateBranding(req, res, next);

    expect(mockUpdateBranding).toHaveBeenCalledWith(
      'agency-1',
      'user-1',
      { description: 'Viajes seguros', slogan: 'Viaja seguro' },
      expect.objectContaining({ source: 'api' }),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Viajes seguros' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects storefront fields over the length limits', async () => {
    const { req, res, next } = createMockReqRes({
      slogan: 'x'.repeat(161),
    });

    await agencySettingsController.updateBranding(req, res, next);

    expect(mockUpdateBranding).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('removes stored cover objects after clearing cover_url', async () => {
    mockUpdateBranding.mockResolvedValue({ ...BRANDING, cover_url: null });
    const { req, res, next, json } = createMockReqRes({ cover_url: null });

    await agencySettingsController.updateBranding(req, res, next);

    expect(mockUpdateBranding).toHaveBeenCalledWith(
      'agency-1',
      'user-1',
      { cover_url: null },
      expect.objectContaining({ source: 'api' }),
    );
    expect(mockRemoveAgencyCover).toHaveBeenCalledWith('agency-1');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ cover_url: null }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('does not touch storage when cover_url is not in the patch', async () => {
    mockUpdateBranding.mockResolvedValue({
      ...BRANDING,
      accent_color: '#ABCDEF',
    });
    const { req, res, next } = createMockReqRes({ accent_color: '#ABCDEF' });

    await agencySettingsController.updateBranding(req, res, next);

    expect(mockRemoveAgencyCover).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('AgencySettingsController.uploadLogo', () => {
  it('uploads for the authenticated agency and persists the returned URL', async () => {
    const logoUrl =
      'https://project.supabase.co/storage/v1/object/public/agency-assets/agency-1/logo.png?v=1';
    mockUploadAgencyLogo.mockResolvedValue(logoUrl);
    mockUpdateBranding.mockResolvedValue({ ...BRANDING, logo_url: logoUrl });
    const { req, res, next, json, png } = createMultipartReqRes();

    await agencySettingsController.uploadLogo(req, res, next);

    expect(mockUploadAgencyLogo).toHaveBeenCalledWith({
      agencyId: 'agency-1',
      buffer: png,
      originalName: 'logo.png',
      mimeType: 'image/png',
    });
    expect(mockUpdateBranding).toHaveBeenCalledWith(
      'agency-1',
      'user-1',
      { logo_url: logoUrl },
      expect.objectContaining({ source: 'api' }),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ logo_url: logoUrl }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a frontend agency_id instead of allowing cross-tenant targeting', async () => {
    const { req, res, next } = createMultipartReqRes({
      includeAgencyField: true,
    });

    await agencySettingsController.uploadLogo(req, res, next);

    expect(mockUploadAgencyLogo).not.toHaveBeenCalled();
    expect(mockUpdateBranding).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});

describe('AgencySettingsController.uploadCover', () => {
  it('uploads the cover for the authenticated agency and persists the URL', async () => {
    const coverUrl =
      'https://project.supabase.co/storage/v1/object/public/agency-assets/agency-1/cover.png?v=1';
    mockUploadAgencyCover.mockResolvedValue(coverUrl);
    mockUpdateBranding.mockResolvedValue({ ...BRANDING, cover_url: coverUrl });
    const { req, res, next, json, png } = createMultipartReqRes({
      fieldName: 'cover',
    });

    await agencySettingsController.uploadCover(req, res, next);

    expect(mockUploadAgencyCover).toHaveBeenCalledWith({
      agencyId: 'agency-1',
      buffer: png,
      originalName: 'cover.png',
      mimeType: 'image/png',
    });
    expect(mockUpdateBranding).toHaveBeenCalledWith(
      'agency-1',
      'user-1',
      { cover_url: coverUrl },
      expect.objectContaining({ source: 'api' }),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ cover_url: coverUrl }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a file posted under the wrong field name', async () => {
    const { req, res, next } = createMultipartReqRes({ fieldName: 'logo' });

    await agencySettingsController.uploadCover(req, res, next);

    expect(mockUploadAgencyCover).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });

  it('never trusts an agency_id field from the browser', async () => {
    const { req, res, next } = createMultipartReqRes({
      fieldName: 'cover',
      includeAgencyField: true,
    });

    await agencySettingsController.uploadCover(req, res, next);

    expect(mockUploadAgencyCover).not.toHaveBeenCalled();
    expect(mockUpdateBranding).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});
