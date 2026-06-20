import { describe, it, expect } from 'vitest';
import { bookingSchema, tripSchema } from '@/lib/validations/booking';

describe('bookingSchema', () => {
  const validBooking = {
    trip_id: '550e8400-e29b-41d4-a716-446655440000',
    seat_id: '550e8400-e29b-41d4-a716-446655440001',
    passenger_name: 'Juan Pérez',
    passenger_cedula: '12345678',
  };

  it('accepts valid booking data', () => {
    const result = bookingSchema.safeParse(validBooking);
    expect(result.success).toBe(true);
  });

  it('rejects invalid trip_id', () => {
    const result = bookingSchema.safeParse({ ...validBooking, trip_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid seat_id', () => {
    const result = bookingSchema.safeParse({ ...validBooking, seat_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects short passenger name', () => {
    const result = bookingSchema.safeParse({ ...validBooking, passenger_name: 'A' });
    expect(result.success).toBe(false);
  });

  it('rejects empty cedula', () => {
    const result = bookingSchema.safeParse({ ...validBooking, passenger_cedula: '' });
    expect(result.success).toBe(false);
  });

  it('rejects cedula with letters', () => {
    const result = bookingSchema.safeParse({ ...validBooking, passenger_cedula: '12ab' });
    expect(result.success).toBe(false);
  });

  it('rejects overlong cedula', () => {
    const result = bookingSchema.safeParse({ ...validBooking, passenger_cedula: '123456789' });
    expect(result.success).toBe(false);
  });

  it('rejects empty passenger name', () => {
    const result = bookingSchema.safeParse({ ...validBooking, passenger_name: '' });
    expect(result.success).toBe(false);
  });
});

describe('tripSchema', () => {
  const validTrip = {
    route_id: '550e8400-e29b-41d4-a716-446655440000',
    departure_at: '2026-07-01T08:00:00Z',
    price: 25,
    total_seats: 30,
    decks: 1,
  };

  it('accepts valid trip data', () => {
    const result = tripSchema.safeParse(validTrip);
    expect(result.success).toBe(true);
  });

  it('rejects invalid route_id', () => {
    const result = tripSchema.safeParse({ ...validTrip, route_id: 'bad' });
    expect(result.success).toBe(false);
  });

  it('rejects negative price', () => {
    const result = tripSchema.safeParse({ ...validTrip, price: -10 });
    expect(result.success).toBe(false);
  });

  it('rejects price of zero', () => {
    const result = tripSchema.safeParse({ ...validTrip, price: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects too few seats', () => {
    const result = tripSchema.safeParse({ ...validTrip, total_seats: 2 });
    expect(result.success).toBe(false);
  });

  it('rejects too many seats', () => {
    const result = tripSchema.safeParse({ ...validTrip, total_seats: 101 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid deck count', () => {
    const result = tripSchema.safeParse({ ...validTrip, decks: 3 });
    expect(result.success).toBe(false);
  });

  it('accepts 2 decks', () => {
    const result = tripSchema.safeParse({ ...validTrip, decks: 2 });
    expect(result.success).toBe(true);
  });
});
