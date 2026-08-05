import { describe, expect, it } from 'vitest';
import { isStaleProcessing, selectStaleProcessingIds } from './stuck.js';

describe('WKR-006.1 — Stuck processing detection', () => {
  const now = new Date('2026-08-05T15:10:00.000Z');

  it('detects processing rows older than stale threshold', () => {
    expect(
      isStaleProcessing(
        {
          status: 'processing',
          updated_at: '2026-08-05T15:00:00.000Z',
        },
        5 * 60_000,
        now,
      ),
    ).toBe(true);
  });

  it('does not recover fresh processing or non-processing rows', () => {
    expect(
      isStaleProcessing(
        {
          status: 'processing',
          updated_at: '2026-08-05T15:09:00.000Z',
        },
        5 * 60_000,
        now,
      ),
    ).toBe(false);

    expect(
      isStaleProcessing(
        {
          status: 'pending',
          updated_at: '2026-08-05T14:00:00.000Z',
        },
        5 * 60_000,
        now,
      ),
    ).toBe(false);
  });

  it('selects oldest stale ids up to limit', () => {
    const ids = selectStaleProcessingIds(
      [
        {
          id: 'new',
          status: 'processing',
          updated_at: '2026-08-05T15:04:00.000Z',
        },
        {
          id: 'old',
          status: 'processing',
          updated_at: '2026-08-05T14:00:00.000Z',
        },
        {
          id: 'pending',
          status: 'pending',
          updated_at: '2026-08-05T14:00:00.000Z',
        },
        {
          id: 'mid',
          status: 'processing',
          updated_at: '2026-08-05T14:30:00.000Z',
        },
      ],
      5 * 60_000,
      2,
      now,
    );
    expect(ids).toEqual(['old', 'mid']);
  });
});
