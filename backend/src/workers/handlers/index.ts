import { supabaseAdmin } from '../../config/database.js';
import {
  RESERVATION_CREATED_V1_TYPE,
  RESERVATION_CREATED_V1_VERSION,
} from '../../events/reservation-created.v1.js';
import { emailService } from '../../services/email.service.js';
import { reservationService } from '../../services/reservation.service.js';
import { getWorkerRuntimeConfig } from '../config.js';
import type { OutboxHandler } from '../outbox/types.js';
import { composeHandlers } from './compose.js';
import { createReservationCreatedHandler } from './reservation-created.handler.js';

export async function loadReservationEmailFlags(reservationId: string) {
  const { data, error } = await supabaseAdmin
    .from('reservations')
    .select('contact_email, send_ticket_email, ticket_email_sent_at')
    .eq('id', reservationId)
    .maybeSingle();

  if (error) {
    throw new Error(`loadReservationEmailFlags: ${error.message}`);
  }
  if (!data) return null;

  return {
    contact_email: (data as any).contact_email ?? null,
    send_ticket_email: Boolean((data as any).send_ticket_email),
    ticket_email_sent_at: (data as any).ticket_email_sent_at ?? null,
  };
}

export async function markTicketEmailSent(reservationId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('reservations')
    .update({ ticket_email_sent_at: new Date().toISOString() })
    .eq('id', reservationId)
    .is('ticket_email_sent_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    throw new Error(`markTicketEmailSent: ${error.message}`);
  }
  return Boolean(data);
}

export function buildDefaultHandlers(): Map<string, OutboxHandler> {
  const cfg = getWorkerRuntimeConfig();
  const map = new Map<string, OutboxHandler>();

  const reservationEmailHandler = createReservationCreatedHandler({
    loadFlags: loadReservationEmailFlags,
    getTicketData: (id) => reservationService.getTicketData(id),
    sendReservationConfirmationEmail: (to, ticket) =>
      emailService.sendReservationConfirmationEmail(to, ticket),
    markTicketEmailSent,
    settleMs: cfg.settleMs,
    settleRetryMs: Math.min(cfg.retryBaseMs, cfg.settleMs),
  });

  // Phase 1 composition boundary. NotificationFanout is implemented in a
  // later phase; this placeholder keeps the registry shape ready without
  // introducing a second effect or changing reservation.created behavior.
  const reservationNotificationPlaceholder: OutboxHandler = async () => ({
    kind: 'completed',
    reason: 'skipped_effect_disabled',
  });

  map.set(
    `${RESERVATION_CREATED_V1_TYPE}:${RESERVATION_CREATED_V1_VERSION}`,
    composeHandlers(
      reservationEmailHandler,
      reservationNotificationPlaceholder,
    ),
  );

  return map;
}

export function resolveHandler(
  handlers: Map<string, OutboxHandler>,
  eventType: string,
  eventVersion: number,
): OutboxHandler | null {
  return handlers.get(`${eventType}:${eventVersion}`) ?? null;
}
