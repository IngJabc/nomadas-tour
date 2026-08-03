import { afterEach, describe, expect, it, vi } from 'vitest';

const mockGetSession = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: () => mockGetSession(),
    },
  }),
}));

import { requestForm } from '@/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('requestForm', () => {
  it('sends FormData without forcing an application/json content type', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'verified-token' } },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const formData = new FormData();
    formData.append(
      'logo',
      new File(['png'], 'logo.png', { type: 'image/png' }),
    );

    await requestForm('/agency/settings/logo', formData, { method: 'POST' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agency/settings/logo'),
      expect.objectContaining({
        method: 'POST',
        body: formData,
        headers: {
          Authorization: 'Bearer verified-token',
        },
      }),
    );
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(
      Object.keys(options.headers as Record<string, string>).some(
        (header) => header.toLowerCase() === 'content-type',
      ),
    ).toBe(false);
  });
});
