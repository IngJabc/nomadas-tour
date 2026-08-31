import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockCreateAuthenticatedClient = vi.fn();
const mockRpc = vi.fn();
const mockUpsert = vi.fn();

const chain = {
  select: mockSelect,
  eq: mockEq,
  single: mockSingle,
};

mockSelect.mockReturnValue(chain);
mockEq.mockReturnValue(chain);
mockFrom.mockReturnValue(chain);
mockCreateAuthenticatedClient.mockReturnValue({ from: mockFrom });

vi.mock('../config/database.js', () => ({
  createAuthenticatedClient: (token: string) =>
    mockCreateAuthenticatedClient(token),
  get supabaseAdmin() {
    return { rpc: mockRpc, from: mockFrom };
  },
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

  it('returns default branding when no agency_settings row exists', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

    const result = await agencySettingsService.getBranding(
      'agency-1',
      'verified-user-token',
    );

    expect(result).toEqual({
      logo_url: null,
      primary_color: '#000024',
      secondary_color: '#0080FF',
      accent_color: '#00D4FF',
    });
  });

  it('updates branding via update_agency_branding RPC with actor from ctx', async () => {
    const patch = { accent_color: '#ABCDEF' };
    mockRpc.mockResolvedValue({
      data: { ...BRANDING, ...patch, changed: true },
      error: null,
    });

    const result = await agencySettingsService.updateBranding(
      'agency-1',
      'user-1',
      patch,
      { source: 'api' },
    );

    expect(mockRpc).toHaveBeenCalledWith('update_agency_branding', {
      p_agency_id: 'agency-1',
      p_actor_user_id: 'user-1',
      p_patch: patch,
      p_metadata: { source: 'api' },
    });
    expect(mockCreateAuthenticatedClient).not.toHaveBeenCalled();
    expect(result.accent_color).toBe('#ABCDEF');
  });

  describe('seedBrandingDefaults', () => {
    it('inserts default branding for a new agency', async () => {
      const upsertChain = { upsert: vi.fn().mockResolvedValue({ error: null }) };
      mockFrom.mockReturnValue(upsertChain);

      await agencySettingsService.seedBrandingDefaults('new-agency-1');

      expect(mockFrom).toHaveBeenCalledWith('agency_settings');
      expect(upsertChain.upsert).toHaveBeenCalledWith(
        {
          agency_id: 'new-agency-1',
          primary_color: '#000024',
          secondary_color: '#0080FF',
          accent_color: '#00D4FF',
        },
        { onConflict: 'agency_id', ignoreDuplicates: true },
      );
    });

    it('does not throw when row already exists (idempotent)', async () => {
      const upsertChain = {
        upsert: vi.fn().mockResolvedValue({ error: null }),
      };
      mockFrom.mockReturnValue(upsertChain);

      await expect(
        agencySettingsService.seedBrandingDefaults('existing-agency-1'),
      ).resolves.toBeUndefined();
    });

    it('throws ValidationError on database error', async () => {
      const upsertChain = {
        upsert: vi.fn().mockResolvedValue({
          error: { message: 'database connection failed' },
        }),
      };
      mockFrom.mockReturnValue(upsertChain);

      await expect(
        agencySettingsService.seedBrandingDefaults('agency-x'),
      ).rejects.toThrow('database connection failed');
    });
  });
});
