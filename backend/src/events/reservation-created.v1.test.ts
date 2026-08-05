import { describe, expect, it } from 'vitest';
import type { OutboxEventRow } from './types.js';
import {
  RESERVATION_CREATED_V1_TYPE,
  RESERVATION_CREATED_V1_VERSION,
  assertNoPiiInReservationCreatedPayload,
  isReservationCreatedPayloadV1,
  parseReservationCreatedEventV1,
} from './reservation-created.v1.js';

const RES_ID = '6bbd52e9-83ab-4954-93ea-ee20466c18a2';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const AGENCY_ID = '22222222-2222-2222-2222-222222222222';

function baseRow(
  overrides: Partial<OutboxEventRow> = {},
): OutboxEventRow {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    event_type: RESERVATION_CREATED_V1_TYPE,
    event_version: RESERVATION_CREATED_V1_VERSION,
    aggregate_type: 'reservation',
    aggregate_id: RES_ID,
    tenant_id: AGENCY_ID,
    payload: {
      reservation_id: RES_ID,
      trip_id: TRIP_ID,
      agency_id: AGENCY_ID,
    },
    status: 'pending',
    attempts: 0,
    available_at: '2026-08-05T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-05T12:00:00.000Z',
    updated_at: '2026-08-05T12:00:00.000Z',
    ...overrides,
  };
}

describe('WKR-004 — reservation.created.v1 contract', () => {
  it('accepts minimal payload', () => {
    expect(
      isReservationCreatedPayloadV1({
        reservation_id: RES_ID,
        trip_id: TRIP_ID,
        agency_id: AGENCY_ID,
      }),
    ).toBe(true);
  });

  it('rejects incomplete payload', () => {
    expect(isReservationCreatedPayloadV1({ reservation_id: RES_ID })).toBe(
      false,
    );
    expect(isReservationCreatedPayloadV1(null)).toBe(false);
  });

  it('rejects PII keys in payload', () => {
    expect(
      assertNoPiiInReservationCreatedPayload({
        reservation_id: RES_ID,
        trip_id: TRIP_ID,
        agency_id: AGENCY_ID,
        document: 'V123',
      }),
    ).toBe(false);
    expect(
      assertNoPiiInReservationCreatedPayload({
        reservation_id: RES_ID,
        phone: '555',
      }),
    ).toBe(false);
    expect(
      assertNoPiiInReservationCreatedPayload({
        reservation_id: RES_ID,
        contact_email: 'a@b.com',
      }),
    ).toBe(false);
    expect(
      assertNoPiiInReservationCreatedPayload({
        reservation_id: RES_ID,
        qr_code: 'NT-X',
      }),
    ).toBe(false);
  });

  it('parses outbox row into EventEnvelope', () => {
    const event = parseReservationCreatedEventV1(baseRow());

    expect(event.type).toBe('reservation.created');
    expect(event.version).toBe(1);
    expect(event.aggregate).toEqual({ type: 'reservation', id: RES_ID });
    expect(event.tenant).toEqual({ agency_id: AGENCY_ID });
    expect(event.data).toEqual({
      reservation_id: RES_ID,
      trip_id: TRIP_ID,
      agency_id: AGENCY_ID,
    });
    expect(event.occurred_at).toBe('2026-08-05T12:00:00.000Z');
  });

  it('throws on wrong type/version or PII', () => {
    expect(() =>
      parseReservationCreatedEventV1(
        baseRow({ event_type: 'reservation.cancelled' }),
      ),
    ).toThrow(/event_type/);

    expect(() =>
      parseReservationCreatedEventV1(baseRow({ event_version: 2 })),
    ).toThrow(/event_version/);

    expect(() =>
      parseReservationCreatedEventV1(
        baseRow({
          payload: {
            reservation_id: RES_ID,
            trip_id: TRIP_ID,
            agency_id: AGENCY_ID,
            email: 'x@y.com',
          },
        }),
      ),
    ).toThrow(/PII/);
  });
});
