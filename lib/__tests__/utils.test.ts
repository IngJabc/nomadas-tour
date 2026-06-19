import { describe, it, expect } from 'vitest';
import { formatPrice, formatDateTime, cn, generateQRCode } from '@/lib/utils';

describe('formatPrice', () => {
  it('formats integer price in EUR', () => {
    expect(formatPrice(50)).toBe('50,00 €');
  });

  it('formats price with decimals', () => {
    expect(formatPrice(25.5)).toBe('25,50 €');
  });

  it('formats zero', () => {
    expect(formatPrice(0)).toBe('0,00 €');
  });

  it('formats large price', () => {
    const result = formatPrice(1234.56);
    expect(result).toContain('€');
    expect(result).toContain('1234');
  });
});

describe('formatDateTime', () => {
  it('formats ISO date string correctly', () => {
    const result = formatDateTime('2026-06-19T14:30:00Z');
    expect(result).toBe('19/06/2026 14:30');
  });

  it('handles different timezone offset', () => {
    const result = formatDateTime('2026-01-05T08:15:00-03:00');
    expect(result).toContain('05/01/2026');
  });
});

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('filters out falsy values', () => {
    expect(cn('foo', false, undefined, null, 'bar')).toBe('foo bar');
  });

  it('returns empty string for no truthy values', () => {
    expect(cn(false, undefined, null)).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(cn()).toBe('');
  });
});

describe('generateQRCode', () => {
  it('generates a string containing CAMPING- prefix', () => {
    const code = generateQRCode();
    expect(code).toMatch(/^CAMPING-/);
  });

  it('includes a timestamp component', () => {
    const code = generateQRCode();
    const parts = code.split('-');
    expect(parts.length).toBe(3);
    expect(parts[1]).toMatch(/^\d+$/);
  });

  it('generates unique codes on successive calls', () => {
    const code1 = generateQRCode();
    const code2 = generateQRCode();
    expect(code1).not.toBe(code2);
  });
});
