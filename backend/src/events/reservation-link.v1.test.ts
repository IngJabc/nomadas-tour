import { describe, expect, it } from 'vitest';
import type { OutboxEventRow } from './types.js';
import {
  parseReservationLinkConfirmedEventV1,
  parseReservationLinkCreatedEventV1,
  parseReservationLinkSavedEventV1,
  RESERVATION_LINK_CREATED_V1_TYPE,
  RESERVATION_LINK_SAVED_V1_TYPE,
  RESERVATION_LINK_CONFIRMED_V1_TYPE,
} from './reservation-link.v1.js';

const LINK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRIP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENCY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function row(type: string, payload: Record<string, unknown>): OutboxEventRow {
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    event_type: type,
    event_version: 1,
    aggregate_type: 'reservation_link',
    aggregate_id: LINK_ID,
    tenant_id: AGENCY_ID,
    payload,
    status: 'pending',
    attempts: 0,
    available_at: '2026-08-18T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-18T12:00:00.000Z',
    updated_at: '2026-08-18T12:00:00.000Z',
  };
}

describe('F5-004 reservation-link events', () => {
  it('parses created/saved/cancelled without PII fields', () => {
    const created = parseReservationLinkCreatedEventV1(
      row(RESERVATION_LINK_CREATED_V1_TYPE, {
        link_id: LINK_ID,
        trip_id: TRIP_ID,
        agency_id: AGENCY_ID,
      }),
    );
    expect(created.data.link_id).toBe(LINK_ID);
    expect(JSON.stringify(created.data)).not.toMatch(/name|document|phone|token/i);

    const saved = parseReservationLinkSavedEventV1(
      row(RESERVATION_LINK_SAVED_V1_TYPE, {
        link_id: LINK_ID,
        trip_id: TRIP_ID,
        agency_id: AGENCY_ID,
      }),
    );
    expect(saved.data.trip_id).toBe(TRIP_ID);
  });

  it('requires reservation_id on confirmed', () => {
    expect(() =>
      parseReservationLinkConfirmedEventV1(
        row(RESERVATION_LINK_CONFIRMED_V1_TYPE, {
          link_id: LINK_ID,
          trip_id: TRIP_ID,
          agency_id: AGENCY_ID,
        }),
      ),
    ).toThrow(/Invalid reservation_link.confirmed/);
  });
});
