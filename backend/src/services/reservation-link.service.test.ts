import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../errors/index.js';

const mockRpc = vi.fn();

vi.mock('../config/env.js', () => ({
  env: {
    FRONTEND_URL: 'http://localhost:3000',
    LOCK_TTL_SECONDS: 600,
  },
}));

vi.mock('../config/database.js', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock('../utils/qr.js', () => ({
  generateQRDataURL: vi.fn(async () => 'data:image/png;base64,xx'),
}));

vi.mock('../utils/token.js', () => ({
  generateToken: () => 'a'.repeat(64),
  hashToken: (token: string) => `hash:${token}`,
}));

import { reservationLinkService } from './reservation-link.service.js';

describe('F5-004 ReservationLinkService', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('createLink hashes token and never sends raw token to SQL', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { link_id: 'link-1', seat_codes: ['A1'], expires_at: '2026-01-01T00:15:00Z' },
      error: null,
    });
    const result = await reservationLinkService.createLink(
      'trip-1',
      ['seat-1'],
      'agency-1',
      'user-1',
    );
    expect(mockRpc).toHaveBeenCalledWith('create_reservation_link', {
      p_trip_id: 'trip-1',
      p_agency_id: 'agency-1',
      p_created_by: 'user-1',
      p_token_hash: `hash:${'a'.repeat(64)}`,
      p_seat_ids: ['seat-1'],
    });
    expect(result.token).toBe('a'.repeat(64));
    expect(result.url).toContain('/reservations/link?token=');
    expect(JSON.stringify(mockRpc.mock.calls[0][1])).not.toContain('?token=');
  });

  it('publicGet rejects malformed tokens as LINK_NOT_FOUND without RPC', async () => {
    await expect(reservationLinkService.publicGet('not-a-token')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('publicGet maps RPC error_code', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ok: false, error_code: 'TRIP_CHANGED', body: null },
      error: null,
    });
    try {
      await reservationLinkService.publicGet('b'.repeat(64));
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { code: string }).code).toBe('TRIP_CHANGED');
      expect((err as { statusCode: number }).statusCode).toBe(410);
    }
    expect(mockRpc.mock.calls[0][0]).toBe('public_get_reservation_link');
    expect(mockRpc.mock.calls[0][1]).toEqual({ p_token_hash: `hash:${'b'.repeat(64)}` });
  });

  it('confirm ignores body and calls RPC with ids only', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { reservation_id: 'res-1', qr_code: 'NT-X', ticket_code: 'ABCDEFGH' },
      error: null,
    });
    const result = await reservationLinkService.confirm('link-1', 'agency-1', 'user-1');
    expect(mockRpc).toHaveBeenCalledWith('confirm_reservation_from_link', {
      p_link_id: 'link-1',
      p_agency_id: 'agency-1',
      p_created_by: 'user-1',
    });
    expect(result.qr_data_url).toBe('data:image/png;base64,xx');
  });
});
