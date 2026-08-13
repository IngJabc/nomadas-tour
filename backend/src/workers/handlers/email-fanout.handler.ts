import { env } from '../../config/env.js';
import { supabaseAdmin } from '../../config/database.js';
import {
  parseTripCancelledEventV1,
  type TripCancelledEventV1,
} from '../../events/trip-cancelled.v1.js';
import {
  parseTripCreatedEventV1,
  type TripCreatedEventV1,
} from '../../events/trip-created.v1.js';
import {
  parseTripPostponedEventV1,
  type TripPostponedEventV1,
} from '../../events/trip-postponed.v1.js';
import type { OutboxEventRow } from '../../events/types.js';
import {
  formatDateForEmail,
  getAgenciesWithEmail,
} from '../../utils/email-fanout.js';
import type { EmailSendResult } from '../../services/email.service.js';
import { emailService } from '../../services/email.service.js';
import { notificationDeliveryPolicy } from '../../services/notification-delivery.policy.js';
import type {
  CompletedHandlerReason,
  HandlerOutcome,
  OutboxHandler,
} from '../outbox/types.js';

/** C5 email fanout events only (plan §6). */
export type EmailFanoutEvent =
  | 'trip.created'
  | 'trip.postponed'
  | 'trip.cancelled';

export type TripEmailType =
  | 'trip_created'
  | 'trip_postponed'
  | 'trip_cancelled';

export interface AgencyEmailRecipient {
  id: string;
  name: string;
  email: string;
}

export interface RouteLabel {
  origin: string;
  destination: string;
}

export interface EmailDeliveryLogRow {
  event_id: string;
  recipient_id: string;
  email_type: string;
  status: 'pending' | 'sent';
}

export interface EmailFanoutDeps {
  isEffectsEnabled: () => boolean;
  getAgenciesWithEmail: (
    agencyIds: string[],
  ) => Promise<AgencyEmailRecipient[]>;
  shouldDeliverEmail: (
    agencyId: string,
    type: TripEmailType,
  ) => Promise<boolean>;
  loadRoute: (routeId: string) => Promise<RouteLabel | null>;
  formatDeparture: (iso: string) => string;
  claimDelivery: (params: {
    eventId: string;
    recipientId: string;
    emailType: TripEmailType;
  }) => Promise<'claimed' | 'already_logged'>;
  markDeliverySent: (params: {
    eventId: string;
    recipientId: string;
    emailType: TripEmailType;
  }) => Promise<void>;
  releaseDeliveryClaim: (params: {
    eventId: string;
    recipientId: string;
    emailType: TripEmailType;
  }) => Promise<void>;
  sendNewTripAssignedEmail: (
    to: string,
    agencyName: string,
    origin: string,
    destination: string,
    departureTime: string,
    vehicleType: string,
    capacity: number,
    tripId: string,
    agencyId: string,
  ) => Promise<EmailSendResult>;
  sendTripPostponedEmail: (
    to: string,
    agencyName: string,
    origin: string,
    destination: string,
    oldDepartureTime: string,
    newDepartureTime: string,
    tripId: string,
    agencyId: string,
  ) => Promise<EmailSendResult>;
  sendTripCancelledEmail: (
    to: string,
    agencyName: string,
    origin: string,
    destination: string,
    departureTime: string,
    tripId: string,
  ) => Promise<EmailSendResult>;
}

const COMPLETED_REASON_PRIORITY: Record<CompletedHandlerReason, number> = {
  sent: 3,
  delivered: 3,
  already_sent: 2,
  already_delivered: 2,
  skipped_no_email: 1,
  skipped_restricted: 1,
  skipped_disabled: 1,
  skipped_no_agencies: 1,
  skipped_effect_disabled: 1,
  skipped_empty: 1,
};

function preferCompleted(
  current: CompletedHandlerReason | null,
  candidate: CompletedHandlerReason,
): CompletedHandlerReason {
  if (!current) return candidate;
  return COMPLETED_REASON_PRIORITY[candidate] > COMPLETED_REASON_PRIORITY[current]
    ? candidate
    : current;
}

export function createDefaultEmailFanoutDeps(): EmailFanoutDeps {
  return {
    isEffectsEnabled: () => env.TRIP_EFFECTS_VIA_OUTBOX,
    getAgenciesWithEmail,
    shouldDeliverEmail: (agencyId, type) =>
      notificationDeliveryPolicy.shouldDeliver(agencyId, type, 'email'),
    async loadRoute(routeId) {
      const { data, error } = await supabaseAdmin
        .from('routes')
        .select('origin, destination')
        .eq('id', routeId)
        .maybeSingle();
      if (error) throw new Error(`loadRoute: ${error.message}`);
      if (!data) return null;
      return {
        origin: (data as RouteLabel).origin,
        destination: (data as RouteLabel).destination,
      };
    },
    formatDeparture: formatDateForEmail,
    async claimDelivery({ eventId, recipientId, emailType }) {
      const { data, error } = await supabaseAdmin
        .from('email_delivery_log')
        .insert({
          event_id: eventId,
          recipient_id: recipientId,
          email_type: emailType,
          status: 'pending',
          attempts: 0,
        })
        .select('event_id')
        .maybeSingle();

      if (error) {
        // PK conflict → already claimed / sent (idempotent skip).
        if ((error as { code?: string }).code === '23505') {
          return 'already_logged';
        }
        throw new Error(`claimDelivery: ${error.message}`);
      }
      return data ? 'claimed' : 'already_logged';
    },
    async markDeliverySent({ eventId, recipientId, emailType }) {
      const { error } = await supabaseAdmin
        .from('email_delivery_log')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          attempts: 1,
          updated_at: new Date().toISOString(),
        })
        .eq('event_id', eventId)
        .eq('recipient_id', recipientId)
        .eq('email_type', emailType);

      if (error) throw new Error(`markDeliverySent: ${error.message}`);
    },
    async releaseDeliveryClaim({ eventId, recipientId, emailType }) {
      const { error } = await supabaseAdmin
        .from('email_delivery_log')
        .delete()
        .eq('event_id', eventId)
        .eq('recipient_id', recipientId)
        .eq('email_type', emailType)
        .eq('status', 'pending');

      if (error) throw new Error(`releaseDeliveryClaim: ${error.message}`);
    },
    sendNewTripAssignedEmail: (...args) =>
      emailService.sendNewTripAssignedEmail(...args),
    sendTripPostponedEmail: (...args) =>
      emailService.sendTripPostponedEmail(...args),
    sendTripCancelledEmail: (...args) =>
      emailService.sendTripCancelledEmail(...args),
  };
}

interface ParsedTripEmailContext {
  emailType: TripEmailType;
  tripId: string;
  routeId: string;
  agencyIds: string[];
  send: (
    agency: AgencyEmailRecipient,
    route: RouteLabel,
  ) => Promise<EmailSendResult>;
}

function parseTripEmailContext(
  event: EmailFanoutEvent,
  row: OutboxEventRow,
  deps: EmailFanoutDeps,
): ParsedTripEmailContext {
  switch (event) {
    case 'trip.created': {
      const parsed: TripCreatedEventV1 = parseTripCreatedEventV1(row);
      return {
        emailType: 'trip_created',
        tripId: parsed.data.trip_id,
        routeId: parsed.data.route_id,
        agencyIds: parsed.data.agency_ids,
        send: (agency, route) =>
          deps.sendNewTripAssignedEmail(
            agency.email,
            agency.name,
            route.origin,
            route.destination,
            deps.formatDeparture(parsed.data.departure_time),
            parsed.data.vehicle_type,
            parsed.data.capacity,
            parsed.data.trip_id,
            agency.id,
          ),
      };
    }
    case 'trip.postponed': {
      const parsed: TripPostponedEventV1 = parseTripPostponedEventV1(row);
      return {
        emailType: 'trip_postponed',
        tripId: parsed.data.trip_id,
        routeId: parsed.data.route_id,
        agencyIds: parsed.data.agency_ids,
        send: (agency, route) =>
          deps.sendTripPostponedEmail(
            agency.email,
            agency.name,
            route.origin,
            route.destination,
            deps.formatDeparture(parsed.data.previous_departure_time),
            deps.formatDeparture(parsed.data.departure_time),
            parsed.data.trip_id,
            agency.id,
          ),
      };
    }
    case 'trip.cancelled': {
      const parsed: TripCancelledEventV1 = parseTripCancelledEventV1(row);
      return {
        emailType: 'trip_cancelled',
        tripId: parsed.data.trip_id,
        routeId: parsed.data.route_id,
        agencyIds: parsed.data.agency_ids,
        send: (agency, route) =>
          deps.sendTripCancelledEmail(
            agency.email,
            agency.name,
            route.origin,
            route.destination,
            deps.formatDeparture(parsed.data.departure_time),
            parsed.data.trip_id,
          ),
      };
    }
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unsupported email fanout event: ${_exhaustive}`);
    }
  }
}

/**
 * WKR-007 C5 — EmailFanout for trip.created / trip.postponed / trip.cancelled.
 * Gated by TRIP_EFFECTS_VIA_OUTBOX. Uses email_delivery_log claim→send→sent.
 * Resend Free restrictions are handled inside EmailService.deliver (skipped_*).
 */
export function createEmailFanoutHandler(
  event: EmailFanoutEvent,
  deps: EmailFanoutDeps = createDefaultEmailFanoutDeps(),
): OutboxHandler {
  return async function handleEmailFanout(
    row: OutboxEventRow,
  ): Promise<HandlerOutcome> {
    if (!deps.isEffectsEnabled()) {
      return { kind: 'completed', reason: 'skipped_effect_disabled' };
    }

    let ctx: ParsedTripEmailContext;
    try {
      ctx = parseTripEmailContext(event, row, deps);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (ctx.agencyIds.length === 0) {
      return { kind: 'completed', reason: 'skipped_no_agencies' };
    }

    let agencies: AgencyEmailRecipient[];
    try {
      agencies = await deps.getAgenciesWithEmail(ctx.agencyIds);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (agencies.length === 0) {
      return { kind: 'completed', reason: 'skipped_no_email' };
    }

    let route: RouteLabel | null;
    try {
      route = await deps.loadRoute(ctx.routeId);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    if (!route) {
      return {
        kind: 'failed',
        permanent: true,
        reason: `Route not found: ${ctx.routeId}`,
      };
    }

    let completedReason: CompletedHandlerReason | null = null;
    let retryableFailure: string | null = null;

    for (const agency of agencies) {
      let allowed: boolean;
      try {
        allowed = await deps.shouldDeliverEmail(agency.id, ctx.emailType);
      } catch (err) {
        // Policy is fail-open at the service layer; unexpected throws are retryable.
        retryableFailure ??=
          err instanceof Error ? err.message : String(err);
        continue;
      }
      // Agency preference gate (legacy parity): skip recipient, keep processing.
      if (!allowed) continue;

      let claim: 'claimed' | 'already_logged';
      try {
        claim = await deps.claimDelivery({
          eventId: row.id,
          recipientId: agency.id,
          emailType: ctx.emailType,
        });
      } catch (err) {
        retryableFailure ??=
          err instanceof Error ? err.message : String(err);
        continue;
      }

      if (claim === 'already_logged') {
        completedReason = preferCompleted(completedReason, 'already_sent');
        continue;
      }

      try {
        const result = await ctx.send(agency, route);

        if (result.status === 'skipped') {
          // Honest skip (Resend Free / disabled): do not mark sent.
          await deps.releaseDeliveryClaim({
            eventId: row.id,
            recipientId: agency.id,
            emailType: ctx.emailType,
          });
          completedReason = preferCompleted(
            completedReason,
            result.reason === 'disabled'
              ? 'skipped_disabled'
              : 'skipped_restricted',
          );
          continue;
        }

        await deps.markDeliverySent({
          eventId: row.id,
          recipientId: agency.id,
          emailType: ctx.emailType,
        });
        completedReason = preferCompleted(completedReason, 'sent');
      } catch (err) {
        try {
          await deps.releaseDeliveryClaim({
            eventId: row.id,
            recipientId: agency.id,
            emailType: ctx.emailType,
          });
        } catch {
          // Prefer surfacing the send failure; release is best-effort.
        }
        retryableFailure ??=
          err instanceof Error ? err.message : String(err);
      }
    }

    if (retryableFailure) {
      return {
        kind: 'failed',
        permanent: false,
        reason: retryableFailure,
      };
    }

    return {
      kind: 'completed',
      reason: completedReason ?? 'skipped_no_email',
    };
  };
}
