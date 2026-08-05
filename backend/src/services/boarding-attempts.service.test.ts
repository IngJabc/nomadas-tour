import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInsert = vi.fn();

vi.mock('../config/database.js', () => ({
  get supabaseAdmin() {
    return {
      from: () => ({
        insert: mockInsert,
      }),
    };
  },
}));

import {
  hashBoardingCredential,
  recordBoardingAttempt,
} from './boarding-attempts.service.js';

describe('boarding-attempts.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never includes plaintext credential fields in insert payload', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await recordBoardingAttempt({
      actor_user_id: 'user-1',
      operator_agency_id: 'agency-1',
      operation: 'lookup',
      outcome: 'success',
      credential_hash: hashBoardingCredential('6BBD52E9'),
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        credential_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        operation: 'lookup',
        outcome: 'success',
      }),
    );

    const payload = mockInsert.mock.calls[0][0];
    expect(payload).not.toHaveProperty('qr_code');
    expect(payload).not.toHaveProperty('ticket_code');
    expect(JSON.stringify(payload)).not.toContain('6BBD52E9');
  });

  it('swallows insert failures so boarding is not interrupted', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'db down' } });
    await expect(
      recordBoardingAttempt({
        actor_user_id: 'user-1',
        operator_agency_id: 'agency-1',
        operation: 'board',
        outcome: 'success',
      }),
    ).resolves.toBeUndefined();
  });
});
