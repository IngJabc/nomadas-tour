import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockFrom = vi.fn();
const mockCreateAuthenticatedClient = vi.fn();

const chain = {
  select: mockSelect,
  update: mockUpdate,
  eq: mockEq,
  single: mockSingle,
};

mockSelect.mockReturnValue(chain);
mockUpdate.mockReturnValue(chain);
mockEq.mockReturnValue(chain);
mockFrom.mockReturnValue(chain);
mockCreateAuthenticatedClient.mockReturnValue({ from: mockFrom });

vi.mock('../config/database.js', () => ({
  createAuthenticatedClient: (token: string) =>
    mockCreateAuthenticatedClient(token),
}));

import { agencySettingsService } from './agency-settings.service.js';

const BRANDING = {
  logo_url: null,
  primary_color: '#000024',
  secondary_color: '#0080FF',
  accent_color: '#00D4FF',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockReturnValue(chain);
  mockUpdate.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockFrom.mockReturnValue(chain);
  mockCreateAuthenticatedClient.mockReturnValue({ from: mockFrom });
});

describe('AgencySettingsService', () => {
  it('reads through an authenticated RLS client and filters by own agency', async () => {
    mockSingle.mockResolvedValue({ data: BRANDING, error: null });

    const result = await agencySettingsService.getBranding(
      'agency-1',
      'verified-user-token',
    );

    expect(mockCreateAuthenticatedClient).toHaveBeenCalledWith(
      'verified-user-token',
    );
    expect(mockFrom).toHaveBeenCalledWith('agency_settings');
    expect(mockEq).toHaveBeenCalledWith('agency_id', 'agency-1');
    expect(result).toEqual(BRANDING);
  });

  it('updates only the row matching the authenticated agency context', async () => {
    const patch = { accent_color: '#ABCDEF' };
    mockSingle.mockResolvedValue({
      data: { ...BRANDING, ...patch },
      error: null,
    });

    const result = await agencySettingsService.updateBranding(
      'agency-1',
      'verified-user-token',
      patch,
    );

    expect(mockUpdate).toHaveBeenCalledWith(patch);
    expect(mockEq).toHaveBeenCalledWith('agency_id', 'agency-1');
    expect(result.accent_color).toBe('#ABCDEF');
  });
});
