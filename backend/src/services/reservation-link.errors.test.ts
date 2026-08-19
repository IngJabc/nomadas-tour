import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  GoneError,
  NotFoundError,
  ValidationError,
} from '../errors/index.js';
import {
  mapPublicLinkErrorCode,
  mapReservationLinkRpcError,
} from './reservation-link.errors.js';

describe('F5-004 reservation-link error mapping', () => {
  it('maps public codes to distinct 404/410', () => {
    expect(() => mapPublicLinkErrorCode('LINK_NOT_FOUND')).toThrow(NotFoundError);
    try {
      mapPublicLinkErrorCode('LINK_EXPIRED');
    } catch (err) {
      expect(err).toBeInstanceOf(GoneError);
      expect((err as GoneError).code).toBe('LINK_EXPIRED');
      expect((err as GoneError).statusCode).toBe(410);
    }
    try {
      mapPublicLinkErrorCode('TRIP_CHANGED');
    } catch (err) {
      expect((err as GoneError).code).toBe('TRIP_CHANGED');
    }
    try {
      mapPublicLinkErrorCode('TRIP_MISSING');
    } catch (err) {
      expect((err as GoneError).code).toBe('TRIP_MISSING');
    }
    try {
      mapPublicLinkErrorCode('LINK_CONFIRMED');
    } catch (err) {
      expect((err as GoneError).code).toBe('LINK_CONFIRMED');
    }
    try {
      mapPublicLinkErrorCode('LINK_CANCELLED');
    } catch (err) {
      expect((err as GoneError).code).toBe('LINK_CANCELLED');
    }
  });

  it('maps agency ERR_* prefixes', () => {
    expect(() => mapReservationLinkRpcError('ERR_SEAT_NOT_IN_LINK: x')).toThrow(
      ValidationError,
    );
    expect(() => mapReservationLinkRpcError('ERR_PASSENGER_INCOMPLETE: x')).toThrow(
      ValidationError,
    );
    try {
      mapReservationLinkRpcError('ERR_LINK_EXPIRED: gone');
    } catch (err) {
      expect(err).toBeInstanceOf(GoneError);
      expect((err as GoneError).code).toBe('LINK_EXPIRED');
    }
    try {
      mapReservationLinkRpcError('ERR_SEAT_INVALID_LOCK: Seat A1');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as Error).message).toContain('ya no están bloqueados');
    }
  });
});
