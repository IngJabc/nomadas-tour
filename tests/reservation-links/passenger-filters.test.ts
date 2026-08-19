import { describe, expect, it } from 'vitest';
import {
  filterPassengerDocument,
  filterPassengerName,
  filterPassengerPhone,
} from '@/lib/reservations/passengerFieldFilters';

describe('passenger field filters', () => {
  it('keeps letters and spaces in names', () => {
    expect(filterPassengerName('Ana María 2')).toBe('Ana María ');
  });

  it('keeps at most 8 document digits', () => {
    expect(filterPassengerDocument('12.345.678-9')).toBe('12345678');
  });

  it('keeps a leading plus in phones', () => {
    expect(filterPassengerPhone('0412-1234567')).toBe('04121234567');
    expect(filterPassengerPhone('+58abc')).toBe('+58');
  });
});
