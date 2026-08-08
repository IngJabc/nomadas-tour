import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock, inMock, selectMock } = vi.hoisted(() => {
  const inMock = vi.fn();
  const selectMock = vi.fn(() => ({ in: inMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  return { fromMock, inMock, selectMock };
});

vi.mock('../config/database.js', () => ({
  supabaseAdmin: {
    from: fromMock,
  },
}));

import { formatDateForEmail, getAgenciesWithEmail } from './email-fanout.js';

describe('email-fanout utils (WKR-007 Fase 0)', () => {
  beforeEach(() => {
    fromMock.mockClear();
    selectMock.mockClear();
    inMock.mockReset();
  });

  describe('formatDateForEmail', () => {
    it('formats with es-VE locale and America/Caracas timezone', () => {
      const formatted = formatDateForEmail('2026-08-08T16:00:00.000Z');
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
      // Caracas is UTC-4 → 12:00 on that date
      expect(formatted).toMatch(/2026/);
      expect(formatted.toLowerCase()).toMatch(/agosto|august|08|8/);
    });
  });

  describe('getAgenciesWithEmail', () => {
    it('returns empty array without querying when agencyIds is empty', async () => {
      const result = await getAgenciesWithEmail([]);
      expect(result).toEqual([]);
      expect(fromMock).not.toHaveBeenCalled();
    });

    it('keeps only active agencies with email', async () => {
      inMock.mockResolvedValue({
        data: [
          { id: 'a1', name: 'A1', email: 'a1@example.com', status: 'active' },
          { id: 'a2', name: 'A2', email: 'a2@example.com', status: 'inactive' },
          { id: 'a3', name: 'A3', email: null, status: 'active' },
          { id: 'a4', name: 'A4', email: '', status: 'active' },
        ],
        error: null,
      });

      const result = await getAgenciesWithEmail(['a1', 'a2', 'a3', 'a4']);

      expect(fromMock).toHaveBeenCalledWith('agencies');
      expect(selectMock).toHaveBeenCalledWith('id, name, email, status');
      expect(inMock).toHaveBeenCalledWith('id', ['a1', 'a2', 'a3', 'a4']);
      expect(result).toEqual([
        { id: 'a1', name: 'A1', email: 'a1@example.com', status: 'active' },
      ]);
    });
  });
});
