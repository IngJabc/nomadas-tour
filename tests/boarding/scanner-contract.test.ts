/**
 * @vitest-environment node
 *
 * AUD-020 P3 — Frontend boarding contract + operator error mapping.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/errors/api-error';
import {
  assertBlockedLookupHasNoPii,
  assertNoBoardingPii,
  applyPassengerToggle,
  getBoardingOperatorMessage,
  getLookupFailureOperatorMessage,
  resolveBoardingDomainCode,
  toggleFeedback,
} from '@/lib/boarding/scan';
import {
  isTicketCode,
  normalizeQrCode,
  validateBoardingCredential,
} from '@/lib/qr';
import type {
  BoardingLookupDTO,
  BoardingLookupResponse,
  BoardingToggleResult,
} from '@/lib/api';

const mockGetSession = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: () => mockGetSession(),
    },
  }),
}));

import { agencyApi } from '@/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const LOOKUP_DTO: BoardingLookupDTO = {
  trip: {
    id: 'trip-1',
    status: 'active',
    departure_time: '2026-08-04T12:00:00.000Z',
    route: { origin: 'Caracas', destination: 'La Olla' },
  },
  reservation_status: 'confirmed',
  reservation_agency_name: 'Agencia Central',
  passengers: [
    {
      id: 'pax-1',
      name: 'Pedro Pasajero',
      seat_code: 'A1',
      boarded: false,
      boarded_at: null,
    },
  ],
};

describe('AUD-020 P3 — credential validation (exact only)', () => {
  it('accepts ticket_code of 8 hex chars', () => {
    expect(isTicketCode('6bbd52e9')).toBe(true);
    expect(validateBoardingCredential('6BBD52E9').valid).toBe(true);
    expect(normalizeQrCode(' 6bbd52e9 ')).toBe('6BBD52E9');
  });

  it('accepts full QR codes', () => {
    const qr = 'NT-LA OLLA-6BBD52E983AB495493EAEE20466C18A2';
    expect(validateBoardingCredential(qr).valid).toBe(true);
  });

  it('rejects fragments', () => {
    expect(validateBoardingCredential('OLLA').valid).toBe(false);
    expect(validateBoardingCredential('NT-LA').valid).toBe(false);
    expect(validateBoardingCredential('6BBD').valid).toBe(false);
  });
});

describe('AUD-020.9 — lookup API envelope', () => {
  const allowedResponse: BoardingLookupResponse = {
    found: true,
    allowed: true,
    failure_code: null,
    result: LOOKUP_DTO,
  };

  it('lookup by ticket_code hits boarding endpoint and returns envelope', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => allowedResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await agencyApi.lookupPassengerByQR('6BBD52E9');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agency/boarding/6BBD52E9'),
      expect.any(Object),
    );
    expect(response.allowed).toBe(true);
    expect(response.found).toBe(true);
    expect(response.failure_code).toBeNull();
    expect(response.result?.passengers[0].seat_code).toBe('A1');
  });

  it('lookup by full QR encodes path and returns envelope', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const qr = 'NT-LA OLLA-6BBD52E983AB495493EAEE20466C18A2';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => allowedResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    await agencyApi.lookupPassengerByQR(qr);

    expect(fetchMock.mock.calls[0][0]).toContain(
      `/agency/boarding/${encodeURIComponent(qr)}`,
    );
  });

  it('maps distinct operator messages per failure_code', () => {
    const notFound = getLookupFailureOperatorMessage('CREDENTIAL_NOT_FOUND');
    const notDeparted = getLookupFailureOperatorMessage('TRIP_NOT_DEPARTED');
    const notAssigned = getLookupFailureOperatorMessage('AGENCY_NOT_ASSIGNED');

    expect(notFound).toBe('No se encontró una reserva con ese código');
    expect(notDeparted).toBe(
      'Este viaje aún no ha salido. El abordaje no está disponible',
    );
    expect(notAssigned).toBe('Tu agencia no está asignada a este viaje');

    expect(notFound).not.toBe(notDeparted);
    expect(notFound).not.toBe(notAssigned);
    expect(notDeparted).not.toBe(notAssigned);

    for (const message of [notFound, notDeparted, notAssigned]) {
      expect(message).not.toContain('PostgREST');
      expect(message).not.toContain('SQL');
      expect(message).not.toContain('relation');
      expect(message).not.toContain('stack');
    }
  });

  it('blocked envelope has no PII / DTO body', () => {
    const blocked: BoardingLookupResponse = {
      found: true,
      allowed: false,
      failure_code: 'TRIP_NOT_DEPARTED',
      result: null,
    };
    expect(assertBlockedLookupHasNoPii(blocked)).toBe(true);
    expect(assertNoBoardingPii(LOOKUP_DTO)).toBe(true);

    const dirty = {
      ...LOOKUP_DTO,
      qr_code: 'NT-SECRET',
      booker_document: 'V123',
    } as BoardingLookupDTO & { qr_code: string; booker_document: string };

    expect(assertNoBoardingPii(dirty)).toBe(false);
  });

  it('allowed flow keeps result DTO usable for scanner', () => {
    expect(allowedResponse.allowed).toBe(true);
    expect(allowedResponse.found).toBe(true);
    expect(allowedResponse.failure_code).toBeNull();
    expect(allowedResponse.result).not.toBeNull();
    expect(assertNoBoardingPii(allowedResponse.result!)).toBe(true);
  });
});

describe('AUD-020 P3 — toggle changed handling', () => {
  it('maps changed=false as no-op success (not an error)', () => {
    const result: BoardingToggleResult = {
      passenger_id: 'pax-1',
      boarded: true,
      boarded_at: '2026-08-04T12:00:00.000Z',
      changed: false,
      reservation_status: 'completed',
      boarded_count: 1,
      total_count: 1,
    };

    expect(toggleFeedback(result)).toEqual({
      kind: 'no_change',
      boarded: true,
    });

    const passengers = applyPassengerToggle(LOOKUP_DTO.passengers, result);
    expect(passengers[0].boarded).toBe(true);
    expect(passengers[0].boarded_at).toBe(result.boarded_at);
  });

  it('maps changed=true board transition', () => {
    const result: BoardingToggleResult = {
      passenger_id: 'pax-1',
      boarded: true,
      boarded_at: '2026-08-04T12:00:00.000Z',
      changed: true,
      reservation_status: 'completed',
      boarded_count: 1,
      total_count: 1,
    };

    expect(toggleFeedback(result).kind).toBe('changed');
  });
});

describe('AUD-020 P3 — operator error messages', () => {
  it('maps domain situations to operator copy without leaking internals', () => {
    const cases: Array<[ApiError, string]> = [
      [
        new ApiError('Tu agencia no está asignada a este viaje', 'FORBIDDEN', 403),
        'AGENCY_NOT_ASSIGNED',
      ],
      [
        new ApiError('Este viaje aún no ha salido. No es posible realizar boarding.', 'VALIDATION_ERROR', 400),
        'TRIP_NOT_DEPARTED',
      ],
      [
        new ApiError('No se puede abordar un pasajero cancelado', 'VALIDATION_ERROR', 400),
        'PASSENGER_CANCELLED',
      ],
      [
        new ApiError('Pasajero no encontrado', 'NOT_FOUND', 404),
        'PASSENGER_NOT_FOUND',
      ],
      [
        new ApiError('relation "boarding_toggle" does not exist', 'UNKNOWN', 500),
        'UNKNOWN',
      ],
    ];

    for (const [error, expectedCode] of cases) {
      expect(resolveBoardingDomainCode(error)).toBe(expectedCode);
      const message = getBoardingOperatorMessage(error, 'toggle');
      expect(message).not.toContain('boarding_toggle');
      expect(message).not.toContain('does not exist');
      expect(message.length).toBeGreaterThan(8);
    }
  });

  it('never returns raw ApiError.message for unknown failures', () => {
    const error = new ApiError(
      'duplicate key value violates unique constraint "x"',
      'INTERNAL_ERROR',
      500,
    );
    const message = getBoardingOperatorMessage(error, 'lookup');
    expect(message).toBe('No se pudo buscar la reserva. Intenta de nuevo');
    expect(message).not.toContain('duplicate key');
  });
});
