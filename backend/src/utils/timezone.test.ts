import { describe, expect, it } from 'vitest';
import {
  BUSINESS_TIMEZONE,
  businessDayBoundsUtc,
  getBusinessHour,
  toBusinessDateString,
  toUTC,
} from './timezone.js';

describe('F4-001 — BUSINESS_TIMEZONE helpers', () => {
  it('keeps America/Caracas as business timezone', () => {
    expect(BUSINESS_TIMEZONE).toBe('America/Caracas');
  });

  it('formats business date without UTC drift near midnight', () => {
    // 2026-08-12 03:30 UTC = 2026-08-11 23:30 Caracas (UTC-4)
    const date = toBusinessDateString(new Date('2026-08-12T03:30:00.000Z'));
    expect(date).toBe('2026-08-11');
  });

  it('returns local hour in Caracas', () => {
    // 2026-08-12 11:00 UTC = 07:00 Caracas
    expect(getBusinessHour(new Date('2026-08-12T11:00:00.000Z'))).toBe(7);
  });

  it('computes Caracas day bounds as UTC instants', () => {
    const { startIso, endIsoExclusive } = businessDayBoundsUtc('2026-08-12');
    expect(startIso).toBe(toUTC('2026-08-12T00:00:00'));
    expect(endIsoExclusive).toBe(toUTC('2026-08-13T00:00:00'));
    expect(new Date(endIsoExclusive).getTime()).toBeGreaterThan(
      new Date(startIso).getTime(),
    );
  });
});
