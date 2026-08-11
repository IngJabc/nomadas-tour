import { supabaseAdmin } from '../../config/database.js';
import {
  RESERVATION_CREATED_V1_TYPE,
  RESERVATION_CREATED_V1_VERSION,
} from '../../events/reservation-created.v1.js';
import {
  TRIP_ARCHIVED_V1_TYPE,
  TRIP_ARCHIVED_V1_VERSION,
} from '../../events/trip-archived.v1.js';
import {
  TRIP_AUTO_COMPLETED_V1_TYPE,
  TRIP_AUTO_COMPLETED_V1_VERSION,
} from '../../events/trip-auto-completed.v1.js';
import {
  TRIP_CANCELLED_V1_TYPE,
  TRIP_CANCELLED_V1_VERSION,
} from '../../events/trip-cancelled.v1.js';
import {
  TRIP_COMPLETED_V1_TYPE,
  TRIP_COMPLETED_V1_VERSION,
} from '../../events/trip-completed.v1.js';
import {
  TRIP_CREATED_V1_TYPE,
  TRIP_CREATED_V1_VERSION,
} from '../../events/trip-created.v1.js';
import {
  TRIP_POSTPONED_V1_TYPE,
  TRIP_POSTPONED_V1_VERSION,
} from '../../events/trip-postponed.v1.js';
import { emailService } from '../../services/email.service.js';
import { reservationService } from '../../services/reservation.service.js';
import { getWorkerRuntimeConfig } from '../config.js';
import type { OutboxHandler } from '../outbox/types.js';
import { composeHandlers } from './compose.js';
import { createEmailFanoutHandler } from './email-fanout.handler.js';
import { createNotificationFanoutHandler } from './notification-fanout.handler.js';
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

  // WKR-007 C4 — NotificationFanout (gated by TRIP_EFFECTS_VIA_OUTBOX).
  const reservationNotificationFanout = createNotificationFanoutHandler(
    'reservation.created',
  );

  map.set(
    `${RESERVATION_CREATED_V1_TYPE}:${RESERVATION_CREATED_V1_VERSION}`,
    composeHandlers(
      reservationEmailHandler,
      reservationNotificationFanout,
    ),
  );

  // WKR-007 C5 — EmailFanout composed with C4 NotificationFanout for trip emails.
  map.set(
    `${TRIP_CREATED_V1_TYPE}:${TRIP_CREATED_V1_VERSION}`,
    composeHandlers(
      createNotificationFanoutHandler('trip.created'),
      createEmailFanoutHandler('trip.created'),
    ),
  );
  map.set(
    `${TRIP_POSTPONED_V1_TYPE}:${TRIP_POSTPONED_V1_VERSION}`,
    composeHandlers(
      createNotificationFanoutHandler('trip.postponed'),
      createEmailFanoutHandler('trip.postponed'),
    ),
  );
  map.set(
    `${TRIP_CANCELLED_V1_TYPE}:${TRIP_CANCELLED_V1_VERSION}`,
    composeHandlers(
      createNotificationFanoutHandler('trip.cancelled'),
      createEmailFanoutHandler('trip.cancelled'),
    ),
  );

  // C4-only (no email fanout in C5).
  map.set(
    `${TRIP_COMPLETED_V1_TYPE}:${TRIP_COMPLETED_V1_VERSION}`,
    createNotificationFanoutHandler('trip.completed'),
  );
  map.set(
    `${TRIP_AUTO_COMPLETED_V1_TYPE}:${TRIP_AUTO_COMPLETED_V1_VERSION}`,
    createNotificationFanoutHandler('trip.auto_completed'),
  );
  map.set(
    `${TRIP_ARCHIVED_V1_TYPE}:${TRIP_ARCHIVED_V1_VERSION}`,
    createNotificationFanoutHandler('trip.archived'),
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
