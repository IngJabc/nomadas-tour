import { env } from '../../config/env.js';
import { supabaseAdmin } from '../../config/database.js';
import {
  parseTripReminderDueEventV1,
  type TripReminderDueEventV1,
  type TripReminderWindow,
} from '../../events/trip-reminder-due.v1.js';
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

export type ReminderEmailType = 'trip_reminder_t48' | 'trip_reminder_t24';

export interface AgencyEmailRecipient {
  id: string;
  name: string;
  email: string;
}

export interface BookerEmailRecipient {
  id: string;
  name: string;
  email: string;
}

export interface RouteLabel {
  origin: string;
  destination: string;
}

export interface ReminderFanoutDeps {
  isEffectsEnabled: () => boolean;
  getAgenciesWithEmail: (
    agencyIds: string[],
  ) => Promise<AgencyEmailRecipient[]>;
  loadBookersWithEmail: (tripId: string) => Promise<BookerEmailRecipient[]>;
  shouldDeliverAgencyEmail: (agencyId: string) => Promise<boolean>;
  loadRoute: (routeId: string) => Promise<RouteLabel | null>;
  formatDeparture: (iso: string) => string;
  claimDelivery: (params: {
    eventId: string;
    recipientId: string;
    emailType: ReminderEmailType;
  }) => Promise<'claimed' | 'already_logged'>;
  markDeliverySent: (params: {
    eventId: string;
    recipientId: string;
    emailType: ReminderEmailType;
  }) => Promise<void>;
  releaseDeliveryClaim: (params: {
    eventId: string;
    recipientId: string;
    emailType: ReminderEmailType;
  }) => Promise<void>;
  sendTripReminderEmail: (
    to: string,
    recipientName: string,
    origin: string,
    destination: string,
    departureTime: string,
    window: TripReminderWindow,
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

export function reminderEmailTypeForWindow(
  window: TripReminderWindow,
): ReminderEmailType {
  return window === 't48' ? 'trip_reminder_t48' : 'trip_reminder_t24';
}

export function createDefaultReminderFanoutDeps(): ReminderFanoutDeps {
  return {
    isEffectsEnabled: () => env.TRIP_REMINDER_VIA_OUTBOX,
    getAgenciesWithEmail,
    async loadBookersWithEmail(tripId) {
      const { data, error } = await supabaseAdmin
        .from('reservations')
        .select('id, booker_name, contact_email')
        .eq('trip_id', tripId)
        .in('status', ['confirmed', 'partial'])
        .not('contact_email', 'is', null);

      if (error) throw new Error(`loadBookersWithEmail: ${error.message}`);

      const rows = (data ?? []) as Array<{
        id: string;
        booker_name: string | null;
        contact_email: string | null;
      }>;

      return rows
        .filter((r) => Boolean(r.contact_email?.trim()))
        .map((r) => ({
          id: r.id,
          name: r.booker_name?.trim() || 'viajero',
          email: r.contact_email!.trim(),
        }));
    },
    // Preferences are keyed by notification type `trip_reminder` (category
    // trip_reminders). Ledger email_type stays window-specific.
    shouldDeliverAgencyEmail: (agencyId) =>
      notificationDeliveryPolicy.shouldDeliver(
        agencyId,
        'trip_reminder',
        'email',
      ),
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
    sendTripReminderEmail: (...args) =>
      emailService.sendTripReminderEmail(...args),
  };
}

/**
 * WKR-008 — Reminder email fanout (booker + agency) for trip.reminder_due.v1.
 * Gated by TRIP_REMINDER_VIA_OUTBOX. Uses email_delivery_log claim→send→sent.
 */
export function createReminderFanoutHandler(
  deps: ReminderFanoutDeps = createDefaultReminderFanoutDeps(),
): OutboxHandler {
  return async function handleReminderFanout(
    row: OutboxEventRow,
  ): Promise<HandlerOutcome> {
    if (!deps.isEffectsEnabled()) {
      return { kind: 'completed', reason: 'skipped_effect_disabled' };
    }

    let parsed: TripReminderDueEventV1;
    try {
      parsed = parseTripReminderDueEventV1(row);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    const emailType = reminderEmailTypeForWindow(parsed.data.window);
    const departureFormatted = deps.formatDeparture(
      parsed.data.departure_time,
    );

    let route: RouteLabel | null;
    try {
      route = await deps.loadRoute(parsed.data.route_id);
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
        reason: `Route not found: ${parsed.data.route_id}`,
      };
    }

    let completedReason: CompletedHandlerReason | null = null;
    let retryableFailure: string | null = null;

    // ── A) Booker emails ──────────────────────────────────────
    let bookers: BookerEmailRecipient[];
    try {
      bookers = await deps.loadBookersWithEmail(parsed.data.trip_id);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    for (const booker of bookers) {
      const outcome = await deliverOne({
        deps,
        eventId: row.id,
        recipientId: booker.id,
        emailType,
        send: () =>
          deps.sendTripReminderEmail(
            booker.email,
            booker.name,
            route.origin,
            route.destination,
            departureFormatted,
            parsed.data.window,
            parsed.data.trip_id,
          ),
      });
      if (outcome.retryableFailure) {
        retryableFailure ??= outcome.retryableFailure;
      }
      if (outcome.completedReason) {
        completedReason = preferCompleted(
          completedReason,
          outcome.completedReason,
        );
      }
    }

    // ── B) Agency emails ──────────────────────────────────────
    if (parsed.data.agency_ids.length === 0) {
      if (retryableFailure) {
        return {
          kind: 'failed',
          permanent: false,
          reason: retryableFailure,
        };
      }
      return {
        kind: 'completed',
        reason: completedReason ?? 'skipped_no_agencies',
      };
    }

    let agencies: AgencyEmailRecipient[];
    try {
      agencies = await deps.getAgenciesWithEmail(parsed.data.agency_ids);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (agencies.length === 0 && bookers.length === 0) {
      return { kind: 'completed', reason: 'skipped_no_email' };
    }

    for (const agency of agencies) {
      let allowed: boolean;
      try {
        allowed = await deps.shouldDeliverAgencyEmail(agency.id);
      } catch (err) {
        retryableFailure ??=
          err instanceof Error ? err.message : String(err);
        continue;
      }
      if (!allowed) continue;

      const outcome = await deliverOne({
        deps,
        eventId: row.id,
        recipientId: agency.id,
        emailType,
        send: () =>
          deps.sendTripReminderEmail(
            agency.email,
            agency.name,
            route.origin,
            route.destination,
            departureFormatted,
            parsed.data.window,
            parsed.data.trip_id,
          ),
      });
      if (outcome.retryableFailure) {
        retryableFailure ??= outcome.retryableFailure;
      }
      if (outcome.completedReason) {
        completedReason = preferCompleted(
          completedReason,
          outcome.completedReason,
        );
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

async function deliverOne(params: {
  deps: ReminderFanoutDeps;
  eventId: string;
  recipientId: string;
  emailType: ReminderEmailType;
  send: () => Promise<EmailSendResult>;
}): Promise<{
  completedReason: CompletedHandlerReason | null;
  retryableFailure: string | null;
}> {
  const { deps, eventId, recipientId, emailType, send } = params;

  let claim: 'claimed' | 'already_logged';
  try {
    claim = await deps.claimDelivery({ eventId, recipientId, emailType });
  } catch (err) {
    return {
      completedReason: null,
      retryableFailure: err instanceof Error ? err.message : String(err),
    };
  }

  if (claim === 'already_logged') {
    return { completedReason: 'already_sent', retryableFailure: null };
  }

  try {
    const result = await send();

    if (result.status === 'skipped') {
      await deps.releaseDeliveryClaim({ eventId, recipientId, emailType });
      return {
        completedReason:
          result.reason === 'disabled'
            ? 'skipped_disabled'
            : 'skipped_restricted',
        retryableFailure: null,
      };
    }

    await deps.markDeliverySent({ eventId, recipientId, emailType });
    return { completedReason: 'sent', retryableFailure: null };
  } catch (err) {
    try {
      await deps.releaseDeliveryClaim({ eventId, recipientId, emailType });
    } catch {
      // Prefer surfacing the send failure; release is best-effort.
    }
    return {
      completedReason: null,
      retryableFailure: err instanceof Error ? err.message : String(err),
    };
  }
}
