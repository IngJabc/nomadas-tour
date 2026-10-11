import { describe, expect, it } from 'vitest';
import {
  COP_CENTS_PER_PESO,
  SEAT_PRICE_MAX_CENTS,
  centsToCopPesos,
  copPesosToCents,
  formatSeatPriceCents,
  parseSeatPricePesosInput,
  seatPriceCentsToInput,
} from '@/lib/price';

describe('TRIP-PRICE-001 — contrato monetario lib/price', () => {
  it('uses exactly 100 cents per COP peso (no silent factor drift)', () => {
    expect(COP_CENTS_PER_PESO).toBe(100);
  });

  it('converts pesos to cents explicitly (x100)', () => {
    expect(copPesosToCents(250_000)).toBe(25_000_000);
    expect(copPesosToCents(0)).toBe(0);
    expect(copPesosToCents(1)).toBe(100);
  });

  it('converts cents back to whole pesos for the form input', () => {
    expect(centsToCopPesos(25_000_000)).toBe(250_000);
    expect(centsToCopPesos(25_000)).toBe(250);
    expect(centsToCopPesos(0)).toBe(0);
  });

  it('formats cents as readable COP, same style as marketplace', () => {
    expect(formatSeatPriceCents(25_000)).toBe('$250,00');
    expect(formatSeatPriceCents(25_000_000)).toBe('$250.000,00');
  });

  it('parses whole-peso input into cents', () => {
    expect(parseSeatPricePesosInput('250000')).toEqual({
      cents: 25_000_000,
      invalid: false,
    });
    expect(parseSeatPricePesosInput('0')).toEqual({ cents: 0, invalid: false });
    expect(parseSeatPricePesosInput('  250  ')).toEqual({
      cents: 25_000,
      invalid: false,
    });
  });

  it('treats an empty input as "no price" (not zero)', () => {
    expect(parseSeatPricePesosInput('')).toEqual({ cents: null, invalid: false });
    expect(parseSeatPricePesosInput('   ')).toEqual({
      cents: null,
      invalid: false,
    });
  });

  it('rejects fractional, signed, separator and alphanumeric input', () => {
    expect(parseSeatPricePesosInput('12.5').invalid).toBe(true);
    expect(parseSeatPricePesosInput('12,5').invalid).toBe(true);
    expect(parseSeatPricePesosInput('-5').invalid).toBe(true);
    expect(parseSeatPricePesosInput('25.000').invalid).toBe(true);
    expect(parseSeatPricePesosInput('12a').invalid).toBe(true);
    expect(parseSeatPricePesosInput('1e3').invalid).toBe(true);
  });

  it('rejects values above the INTEGER column range', () => {
    const tooManyPesos = String(Math.floor(SEAT_PRICE_MAX_CENTS / 100) + 1);
    expect(parseSeatPricePesosInput(tooManyPesos).invalid).toBe(true);
  });

  it('maps existing trip cents to the input text without decimals', () => {
    expect(seatPriceCentsToInput(25_000_000)).toBe('250000');
    expect(seatPriceCentsToInput(25_000)).toBe('250');
    expect(seatPriceCentsToInput(null)).toBe('');
    expect(seatPriceCentsToInput(undefined)).toBe('');
  });
});
