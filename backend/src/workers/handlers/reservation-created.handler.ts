import {
  parseReservationCreatedEventV1,
  type ReservationCreatedEventV1,
} from '../../events/reservation-created.v1.js';
import type { OutboxEventRow } from '../../events/types.js';
import { NotFoundError } from '../../errors/index.js';
import type { TicketData } from '../../types/reservation.js';
import type { EmailSendResult } from '../../services/email.service.js';
import type { HandlerOutcome } from '../outbox/types.js';

export interface ReservationEmailFlags {
  contact_email: string | null;
  send_ticket_email: boolean;
  ticket_email_sent_at: string | null;
}

export interface ReservationCreatedHandlerDeps {
  loadFlags: (reservationId: string) => Promise<ReservationEmailFlags | null>;
  getTicketData: (reservationId: string) => Promise<TicketData>;
  sendReservationConfirmationEmail: (
    to: string,
    ticket: TicketData,
  ) => Promise<EmailSendResult>;
  markTicketEmailSent: (reservationId: string) => Promise<boolean>;
  settleMs: number;
  settleRetryMs: number;
  now?: () => Date;
}

/**
 * Strategy B (WKR-005.1): if event is still within settle window and email
 * flags look unset, requeue instead of completing as "no email".
 */
export function createReservationCreatedHandler(
  deps: ReservationCreatedHandlerDeps,
) {
  return async function handleReservationCreated(
    row: OutboxEventRow,
  ): Promise<HandlerOutcome> {
    let event: ReservationCreatedEventV1;
    try {
      event = parseReservationCreatedEventV1(row);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    const { reservation_id } = event.data;
    const flags = await deps.loadFlags(reservation_id);

    if (!flags) {
      return {
        kind: 'failed',
        permanent: true,
        reason: `Reservation not found: ${reservation_id}`,
      };
    }

    if (flags.ticket_email_sent_at) {
      return { kind: 'completed', reason: 'already_sent' };
    }

    const now = deps.now?.() ?? new Date();
    const ageMs = now.getTime() - new Date(row.created_at).getTime();
    const withinSettle = ageMs < deps.settleMs;

    const wantsEmail = Boolean(flags.send_ticket_email);
    const hasContact = Boolean(flags.contact_email?.trim());

    // Race: RPC commit wrote outbox before service UPDATEs flags.
    if (withinSettle && !wantsEmail && !hasContact) {
      return {
        kind: 'requeue',
        reason: 'flags_not_settled',
        delayMs: deps.settleRetryMs,
      };
    }

    if (withinSettle && wantsEmail && !hasContact) {
      return {
        kind: 'requeue',
        reason: 'contact_email_pending',
        delayMs: deps.settleRetryMs,
      };
    }

    if (!wantsEmail || !hasContact) {
      return { kind: 'completed', reason: 'skipped_no_email' };
    }

    try {
      const ticket = await deps.getTicketData(reservation_id);
      const result = await deps.sendReservationConfirmationEmail(
        flags.contact_email!.trim(),
        ticket,
      );

      if (result.status === 'skipped') {
        return {
          kind: 'completed',
          reason:
            result.reason === 'disabled'
              ? 'skipped_disabled'
              : 'skipped_restricted',
        };
      }

      await deps.markTicketEmailSent(reservation_id);
      return { kind: 'completed', reason: 'sent' };
    } catch (err) {
      if (err instanceof NotFoundError) {
        return {
          kind: 'failed',
          permanent: true,
          reason: err.message,
        };
      }
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
