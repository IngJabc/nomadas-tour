import { describe, expect, it, vi } from 'vitest';
import type { OutboxEventRow } from '../../events/types.js';
import {
  RESERVATION_CREATED_V1_TYPE,
  RESERVATION_CREATED_V1_VERSION,
} from '../../events/reservation-created.v1.js';
import {
  createReservationCreatedHandler,
  type ReservationCreatedHandlerDeps,
} from './reservation-created.handler.js';

const RES_ID = '6bbd52e9-83ab-4954-93ea-ee20466c18a2';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const AGENCY_ID = '22222222-2222-2222-2222-222222222222';

function row(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
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
    status: 'processing',
    attempts: 1,
    available_at: '2026-08-05T12:00:00.000Z',
    processed_at: null,
    error_message: null,
    created_at: '2026-08-05T12:00:00.000Z',
    updated_at: '2026-08-05T12:00:00.000Z',
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<ReservationCreatedHandlerDeps> = {},
): ReservationCreatedHandlerDeps {
  return {
    loadFlags: vi.fn(async () => ({
      contact_email: 'cliente@example.com',
      send_ticket_email: true,
      ticket_email_sent_at: null,
    })),
    getTicketData: vi.fn(async () => ({
      reservation_id: RES_ID,
      qr_code: 'NT-X',
      qr_data_url: 'data:image/png;base64,xx',
      status: 'confirmed',
      created_at: '2026-08-05T12:00:00.000Z',
      booker_name: 'Juan',
      booker_document: 'V1',
      booker_phone: null,
      trip: null,
      passengers: [],
    })),
    sendReservationConfirmationEmail: vi.fn(async () => undefined),
    markTicketEmailSent: vi.fn(async () => true),
    settleMs: 5000,
    settleRetryMs: 1000,
    now: () => new Date('2026-08-05T12:00:10.000Z'),
    ...overrides,
  };
}

describe('WKR-005 — ReservationCreatedHandler', () => {
  it('sends email and marks sent', async () => {
    const deps = makeDeps();
    const handler = createReservationCreatedHandler(deps);

    const outcome = await handler(row());

    expect(outcome).toEqual({ kind: 'completed', reason: 'sent' });
    expect(deps.sendReservationConfirmationEmail).toHaveBeenCalledOnce();
    expect(deps.markTicketEmailSent).toHaveBeenCalledWith(RES_ID);
  });

  it('skips when ticket_email_sent_at already set', async () => {
    const deps = makeDeps({
      loadFlags: vi.fn(async () => ({
        contact_email: 'cliente@example.com',
        send_ticket_email: true,
        ticket_email_sent_at: '2026-08-05T12:00:01.000Z',
      })),
    });
    const handler = createReservationCreatedHandler(deps);

    const outcome = await handler(row());

    expect(outcome).toEqual({ kind: 'completed', reason: 'already_sent' });
    expect(deps.sendReservationConfirmationEmail).not.toHaveBeenCalled();
  });

  it('completes without send when send_ticket_email=false after settle', async () => {
    const deps = makeDeps({
      loadFlags: vi.fn(async () => ({
        contact_email: null,
        send_ticket_email: false,
        ticket_email_sent_at: null,
      })),
      now: () => new Date('2026-08-05T12:00:10.000Z'),
    });
    const handler = createReservationCreatedHandler(deps);

    const outcome = await handler(
      row({ created_at: '2026-08-05T12:00:00.000Z' }),
    );

    expect(outcome).toEqual({ kind: 'completed', reason: 'skipped_no_email' });
    expect(deps.sendReservationConfirmationEmail).not.toHaveBeenCalled();
  });

  it('requeues when flags not settled (strategy B)', async () => {
    const deps = makeDeps({
      loadFlags: vi.fn(async () => ({
        contact_email: null,
        send_ticket_email: false,
        ticket_email_sent_at: null,
      })),
      now: () => new Date('2026-08-05T12:00:01.000Z'),
    });
    const handler = createReservationCreatedHandler(deps);

    const outcome = await handler(
      row({ created_at: '2026-08-05T12:00:00.000Z' }),
    );

    expect(outcome).toEqual({
      kind: 'requeue',
      reason: 'flags_not_settled',
      delayMs: 1000,
    });
    expect(deps.sendReservationConfirmationEmail).not.toHaveBeenCalled();
  });

  it('requeues on temporary Resend failure', async () => {
    const deps = makeDeps({
      sendReservationConfirmationEmail: vi.fn(async () => {
        throw new Error('Failed to send reservation confirmation email');
      }),
    });
    const handler = createReservationCreatedHandler(deps);

    const outcome = await handler(row());

    expect(outcome).toEqual({
      kind: 'failed',
      permanent: false,
      reason: 'Failed to send reservation confirmation email',
    });
  });
});
