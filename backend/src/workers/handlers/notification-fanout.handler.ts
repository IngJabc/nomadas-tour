import { env } from '../../config/env.js';
import { supabaseAdmin } from '../../config/database.js';
import {
  parseReservationCreatedEventV1,
  type ReservationCreatedEventV1,
} from '../../events/reservation-created.v1.js';
import {
  parseTripArchivedEventV1,
  type TripArchivedEventV1,
} from '../../events/trip-archived.v1.js';
import {
  parseTripAutoCompletedEventV1,
  type TripAutoCompletedEventV1,
} from '../../events/trip-auto-completed.v1.js';
import {
  parseTripCancelledEventV1,
  type TripCancelledEventV1,
} from '../../events/trip-cancelled.v1.js';
import {
  parseTripCompletedEventV1,
  type TripCompletedEventV1,
} from '../../events/trip-completed.v1.js';
import {
  parseTripCreatedEventV1,
  type TripCreatedEventV1,
} from '../../events/trip-created.v1.js';
import {
  parseTripPostponedEventV1,
  type TripPostponedEventV1,
} from '../../events/trip-postponed.v1.js';
import {
  parseTripReminderDueEventV1,
  type TripReminderDueEventV1,
} from '../../events/trip-reminder-due.v1.js';
import {
  parseTripOccupancyAlertDueEventV1,
  type TripOccupancyAlertDueEventV1,
} from '../../events/trip-occupancy-alert-due.v1.js';
import { computeCanonicalOccupancy } from '../../services/occupancy-alert.service.js';
import type { OutboxEventRow } from '../../events/types.js';
import { formatDateForEmail } from '../../utils/email-fanout.js';
import {
  notificationDeliveryPolicy,
  type AgencyNotificationRow,
} from '../../services/notification-delivery.policy.js';
import type {
  EntityType,
  NotificationActor,
  NotificationType,
  RecipientRole,
} from '../../services/notification.service.js';
import type { HandlerOutcome, OutboxHandler } from '../outbox/types.js';

export type NotificationFanoutEvent =
  | 'reservation.created'
  | 'trip.created'
  | 'trip.postponed'
  | 'trip.cancelled'
  | 'trip.completed'
  | 'trip.auto_completed'
  | 'trip.archived'
  /** WKR-008 — in-app reminder; gated via TRIP_REMINDER_VIA_OUTBOX deps. */
  | 'trip_reminder'
  /** F4-003 — in-app occupancy alert; gated via OCCUPANCY_ALERT_VIA_WORKER. */
  | 'trip.occupancy_alert';

export interface NotificationFanoutInsertRow extends AgencyNotificationRow {
  type: NotificationType;
  title: string;
  body: string;
  entity_type: EntityType;
  entity_id: string;
  agency_id: string | null;
  recipient_role: RecipientRole;
  action_url: string | null;
  metadata: Record<string, unknown>;
  source_event_id: string;
}

export interface RouteLabel {
  origin: string;
  destination: string;
}

export interface ReservationNotificationContext {
  booker_name: string;
  passenger_count: number;
  trip_id: string;
  origin: string | null;
  destination: string | null;
}

export interface NotificationFanoutDeps {
  isEffectsEnabled: () => boolean;
  filterAgencyNotificationRows: <T extends AgencyNotificationRow>(
    rows: T[],
  ) => Promise<T[]>;
  findExistingBySourceEventId: (
    sourceEventId: string,
  ) => Promise<Array<{ agency_id: string | null; recipient_role: string }>>;
  insertNotificationRows: (
    rows: NotificationFanoutInsertRow[],
  ) => Promise<{ error: { message: string; code?: string } | null }>;
  loadRoute: (routeId: string) => Promise<RouteLabel | null>;
  loadReservationContext: (
    reservationId: string,
    tripId: string,
  ) => Promise<ReservationNotificationContext | null>;
  formatDeparture: (iso: string) => string;
  loadTripAgencyIds?: (tripId: string) => Promise<string[]>;
  loadLiveOccupancy?: (
    tripId: string,
  ) => Promise<{
    reserved: number;
    total: number;
    available: number;
    occupancy_pct: number;
  } | null>;
}

function recipientKey(
  agencyId: string | null | undefined,
  role: string,
): string {
  return `${agencyId ?? '*'}|${role}`;
}

function buildAgencyAndOptionalAdminRows(params: {
  type: NotificationType;
  title: string;
  body: string;
  entityType: EntityType;
  entityId: string;
  agencyIds: string[];
  actor: NotificationActor;
  sourceEventId: string;
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
}): NotificationFanoutInsertRow[] {
  const rows: NotificationFanoutInsertRow[] = [];
  const metadata = params.metadata ?? {};
  const actionUrl = params.actionUrl ?? null;

  for (const agencyId of params.agencyIds) {
    rows.push({
      type: params.type,
      title: params.title,
      body: params.body,
      entity_type: params.entityType,
      entity_id: params.entityId,
      agency_id: agencyId,
      recipient_role: 'agency',
      action_url: actionUrl,
      metadata,
      source_event_id: params.sourceEventId,
    });
  }

  // Mirrors notificationService.createForAgenciesAndAdmin: only system
  // actor also notifies superadmin.
  if (params.actor === 'system') {
    rows.push({
      type: params.type,
      title: params.title,
      body: params.body,
      entity_type: params.entityType,
      entity_id: params.entityId,
      agency_id: null,
      recipient_role: 'superadmin',
      action_url: actionUrl,
      metadata,
      source_event_id: params.sourceEventId,
    });
  }

  return rows;
}

export function createDefaultNotificationFanoutDeps(): NotificationFanoutDeps {
  return {
    isEffectsEnabled: () => env.TRIP_EFFECTS_VIA_OUTBOX,
    filterAgencyNotificationRows: (rows) =>
      notificationDeliveryPolicy.filterAgencyNotificationRows(rows),
    async findExistingBySourceEventId(sourceEventId) {
      const { data, error } = await supabaseAdmin
        .from('notifications')
        .select('agency_id, recipient_role')
        .eq('source_event_id', sourceEventId);
      if (error) {
        throw new Error(`findExistingBySourceEventId: ${error.message}`);
      }
      return (data ?? []) as Array<{
        agency_id: string | null;
        recipient_role: string;
      }>;
    },
    async insertNotificationRows(rows) {
      const { error } = await supabaseAdmin.from('notifications').insert(rows);
      return {
        error: error
          ? { message: error.message, code: (error as { code?: string }).code }
          : null,
      };
    },
    async loadRoute(routeId) {
      const { data, error } = await supabaseAdmin
        .from('routes')
        .select('origin, destination')
        .eq('id', routeId)
        .maybeSingle();
      if (error) {
        throw new Error(`loadRoute: ${error.message}`);
      }
      if (!data) return null;
      return {
        origin: (data as RouteLabel).origin,
        destination: (data as RouteLabel).destination,
      };
    },
    async loadReservationContext(reservationId, tripId) {
      const { data: reservation, error: reservationError } = await supabaseAdmin
        .from('reservations')
        .select('booker_name, reservation_passengers(id)')
        .eq('id', reservationId)
        .maybeSingle();
      if (reservationError) {
        throw new Error(
          `loadReservationContext: ${reservationError.message}`,
        );
      }
      if (!reservation) return null;

      const { data: trip, error: tripError } = await supabaseAdmin
        .from('trips')
        .select('routes(origin, destination)')
        .eq('id', tripId)
        .maybeSingle();
      if (tripError) {
        throw new Error(`loadReservationContext: ${tripError.message}`);
      }

      const route = (trip as { routes?: RouteLabel | RouteLabel[] | null } | null)
        ?.routes;
      const routeRow = Array.isArray(route) ? route[0] : route;

      return {
        booker_name: (reservation as { booker_name?: string }).booker_name || 'cliente',
        passenger_count: Array.isArray(
          (reservation as { reservation_passengers?: unknown[] })
            .reservation_passengers,
        )
          ? (reservation as { reservation_passengers: unknown[] })
              .reservation_passengers.length
          : 0,
        trip_id: tripId,
        origin: routeRow?.origin ?? null,
        destination: routeRow?.destination ?? null,
      };
    },
    formatDeparture: formatDateForEmail,
    async loadTripAgencyIds(tripId) {
      const { data, error } = await supabaseAdmin
        .from('trip_agencies')
        .select('agency_id, agencies!inner(status)')
        .eq('trip_id', tripId)
        .eq('agencies.status', 'active');
      if (error) {
        throw new Error(`loadTripAgencyIds: ${error.message}`);
      }
      return (data ?? []).map((row) => row.agency_id as string);
    },
    async loadLiveOccupancy(tripId) {
      const { data: trip, error: tripError } = await supabaseAdmin
        .from('trips')
        .select('capacity')
        .eq('id', tripId)
        .maybeSingle();
      if (tripError) {
        throw new Error(`loadLiveOccupancy: ${tripError.message}`);
      }
      if (!trip) return null;

      const { data: seats, error: seatError } = await supabaseAdmin
        .from('seats')
        .select('status')
        .eq('trip_id', tripId);
      if (seatError) {
        throw new Error(`loadLiveOccupancy: ${seatError.message}`);
      }

      const occupancy = computeCanonicalOccupancy(
        (seats ?? []) as Array<{ status: string }>,
        Number((trip as { capacity?: number }).capacity) || 0,
      );
      if (!occupancy.ok) return null;
      return {
        reserved: occupancy.reserved,
        total: occupancy.total,
        available: occupancy.available,
        occupancy_pct: occupancy.occupancy_pct,
      };
    },
  };
}

async function buildRowsForEvent(
  row: OutboxEventRow,
  deps: NotificationFanoutDeps,
  event: NotificationFanoutEvent,
): Promise<
  | { ok: true; rows: NotificationFanoutInsertRow[] }
  | { ok: false; outcome: HandlerOutcome }
> {
  try {
    switch (event) {
      case 'reservation.created': {
        const parsed: ReservationCreatedEventV1 =
          parseReservationCreatedEventV1(row);
        const ctx = await deps.loadReservationContext(
          parsed.data.reservation_id,
          parsed.data.trip_id,
        );
        if (!ctx) {
          return {
            ok: false,
            outcome: {
              kind: 'failed',
              permanent: true,
              reason: `Reservation not found: ${parsed.data.reservation_id}`,
            },
          };
        }
        const routeLabel =
          ctx.origin && ctx.destination
            ? `${ctx.origin} → ${ctx.destination}`
            : 'viaje';
        // Mirrors createForAgency(actor: 'agency') → superadmin only.
        return {
          ok: true,
          rows: [
            {
              type: 'reservation_created',
              title: 'Nueva reserva',
              body: `${ctx.booker_name} realizó una reserva de ${ctx.passenger_count} pasajeros para ${routeLabel}`,
              entity_type: 'reservation',
              entity_id: parsed.data.reservation_id,
              agency_id: null,
              recipient_role: 'superadmin',
              action_url: `/admin/bookings/${parsed.data.reservation_id}`,
              metadata: {
                reservation_id: parsed.data.reservation_id,
                trip_id: parsed.data.trip_id,
                booker_name: ctx.booker_name,
                passenger_count: ctx.passenger_count,
                origin: ctx.origin,
                destination: ctx.destination,
              },
              source_event_id: row.id,
            },
          ],
        };
      }
      case 'trip.created': {
        const parsed: TripCreatedEventV1 = parseTripCreatedEventV1(row);
        if (parsed.data.agency_ids.length === 0) {
          return {
            ok: false,
            outcome: { kind: 'completed', reason: 'skipped_no_agencies' },
          };
        }
        const route = await deps.loadRoute(parsed.data.route_id);
        const origin = route?.origin ?? '?';
        const destination = route?.destination ?? '?';
        const departureFormatted = deps.formatDeparture(
          parsed.data.departure_time,
        );
        return {
          ok: true,
          rows: buildAgencyAndOptionalAdminRows({
            type: 'trip_created',
            title: 'Viaje creado',
            body: `Viaje asignado: ${origin} → ${destination} el ${departureFormatted}`,
            entityType: 'trip',
            entityId: parsed.data.trip_id,
            agencyIds: parsed.data.agency_ids,
            actor: 'superadmin',
            sourceEventId: row.id,
            actionUrl: `/agency/trips/${parsed.data.trip_id}/passengers`,
            metadata: {
              trip_id: parsed.data.trip_id,
              origin,
              destination,
              departure_time: parsed.data.departure_time,
            },
          }),
        };
      }
      case 'trip.postponed': {
        const parsed: TripPostponedEventV1 = parseTripPostponedEventV1(row);
        if (parsed.data.agency_ids.length === 0) {
          return {
            ok: false,
            outcome: { kind: 'completed', reason: 'skipped_no_agencies' },
          };
        }
        const route = await deps.loadRoute(parsed.data.route_id);
        const origin = route?.origin ?? '?';
        const destination = route?.destination ?? '?';
        const newDepartureFormatted = deps.formatDeparture(
          parsed.data.departure_time,
        );
        return {
          ok: true,
          rows: buildAgencyAndOptionalAdminRows({
            type: 'trip_postponed',
            title: 'Viaje pospuesto',
            body: `El viaje a ${destination} fue pospuesto. Nueva salida: ${newDepartureFormatted}`,
            entityType: 'trip',
            entityId: parsed.data.trip_id,
            agencyIds: parsed.data.agency_ids,
            actor: 'superadmin',
            sourceEventId: row.id,
            actionUrl: `/agency/trips/${parsed.data.trip_id}/passengers`,
            metadata: {
              trip_id: parsed.data.trip_id,
              origin,
              destination,
              old_departure_time: parsed.data.previous_departure_time,
              new_departure_time: parsed.data.departure_time,
            },
          }),
        };
      }
      case 'trip.cancelled': {
        const parsed: TripCancelledEventV1 = parseTripCancelledEventV1(row);
        if (parsed.data.agency_ids.length === 0) {
          return {
            ok: false,
            outcome: { kind: 'completed', reason: 'skipped_no_agencies' },
          };
        }
        const route = await deps.loadRoute(parsed.data.route_id);
        const routeLabel = route
          ? `${route.origin} → ${route.destination}`
          : 'viaje';
        return {
          ok: true,
          rows: buildAgencyAndOptionalAdminRows({
            type: 'trip_cancelled',
            title: 'Viaje cancelado',
            body: `El viaje ${routeLabel} del ${deps.formatDeparture(parsed.data.departure_time)} fue cancelado`,
            entityType: 'trip',
            entityId: parsed.data.trip_id,
            agencyIds: parsed.data.agency_ids,
            actor: 'superadmin',
            sourceEventId: row.id,
            actionUrl: `/agency/trips/${parsed.data.trip_id}/passengers`,
            metadata: {
              trip_id: parsed.data.trip_id,
              origin: route?.origin ?? null,
              destination: route?.destination ?? null,
              departure_time: parsed.data.departure_time,
            },
          }),
        };
      }
      case 'trip.completed': {
        const parsed: TripCompletedEventV1 = parseTripCompletedEventV1(row);
        if (parsed.data.agency_ids.length === 0) {
          return {
            ok: false,
            outcome: { kind: 'completed', reason: 'skipped_no_agencies' },
          };
        }
        const route = await deps.loadRoute(parsed.data.route_id);
        const routeLabel = route
          ? `${route.origin} → ${route.destination}`
          : 'viaje';
        return {
          ok: true,
          rows: buildAgencyAndOptionalAdminRows({
            type: 'trip_completed',
            title: 'Viaje completado',
            body: `El viaje ${routeLabel} fue completado`,
            entityType: 'trip',
            entityId: parsed.data.trip_id,
            agencyIds: parsed.data.agency_ids,
            actor: 'superadmin',
            sourceEventId: row.id,
            metadata: {
              trip_id: parsed.data.trip_id,
              origin: route?.origin ?? null,
              destination: route?.destination ?? null,
              departure_time: parsed.data.departure_time,
            },
          }),
        };
      }
      case 'trip.auto_completed': {
        const parsed: TripAutoCompletedEventV1 =
          parseTripAutoCompletedEventV1(row);
        if (parsed.data.agency_ids.length === 0) {
          return {
            ok: false,
            outcome: { kind: 'completed', reason: 'skipped_no_agencies' },
          };
        }
        const route = await deps.loadRoute(parsed.data.route_id);
        const routeLabel = route
          ? `${route.origin} → ${route.destination}`
          : 'viaje';
        return {
          ok: true,
          rows: buildAgencyAndOptionalAdminRows({
            type: 'trip_auto_completed',
            title: 'Viaje completado automáticamente',
            body: `El viaje ${routeLabel} fue completado automáticamente`,
            entityType: 'trip',
            entityId: parsed.data.trip_id,
            agencyIds: parsed.data.agency_ids,
            actor: 'system',
            sourceEventId: row.id,
            metadata: {
              trip_id: parsed.data.trip_id,
              origin: route?.origin ?? null,
              destination: route?.destination ?? null,
              departure_time: parsed.data.departure_time,
            },
          }),
        };
      }
      case 'trip.archived': {
        const parsed: TripArchivedEventV1 = parseTripArchivedEventV1(row);
        if (parsed.data.agency_ids.length === 0) {
          return {
            ok: false,
            outcome: { kind: 'completed', reason: 'skipped_no_agencies' },
          };
        }
        const route = await deps.loadRoute(parsed.data.route_id);
        const routeLabel = route
          ? `${route.origin} → ${route.destination}`
          : 'viaje';
        return {
          ok: true,
          rows: buildAgencyAndOptionalAdminRows({
            type: 'trip_archived',
            title: 'Viaje archivado',
            body: `El viaje ${routeLabel} fue archivado y ya no aparece en la vista principal`,
            entityType: 'trip',
            entityId: parsed.data.trip_id,
            agencyIds: parsed.data.agency_ids,
            actor: 'superadmin',
            sourceEventId: row.id,
            metadata: {
              trip_id: parsed.data.trip_id,
              origin: route?.origin ?? null,
              destination: route?.destination ?? null,
              departure_time: parsed.data.departure_time,
            },
          }),
        };
      }
      case 'trip_reminder': {
        const parsed: TripReminderDueEventV1 =
          parseTripReminderDueEventV1(row);
        if (parsed.data.agency_ids.length === 0) {
          return {
            ok: false,
            outcome: { kind: 'completed', reason: 'skipped_no_agencies' },
          };
        }
        const route = await deps.loadRoute(parsed.data.route_id);
        const origin = route?.origin ?? '?';
        const destination = route?.destination ?? '?';
        const departureFormatted = deps.formatDeparture(
          parsed.data.departure_time,
        );
        const headline =
          parsed.data.window === 't48'
            ? 'Tu viaje sale en dos días'
            : 'Tu viaje sale mañana';
        return {
          ok: true,
          rows: buildAgencyAndOptionalAdminRows({
            type: 'trip_reminder',
            title: 'Recordatorio de viaje',
            body: `${headline}: ${origin} → ${destination} el ${departureFormatted}`,
            entityType: 'trip',
            entityId: parsed.data.trip_id,
            agencyIds: parsed.data.agency_ids,
            actor: 'superadmin',
            sourceEventId: row.id,
            actionUrl: `/agency/trips/${parsed.data.trip_id}/passengers`,
            metadata: {
              trip_id: parsed.data.trip_id,
              origin,
              destination,
              departure_time: parsed.data.departure_time,
              window: parsed.data.window,
            },
          }),
        };
      }
      case 'trip.occupancy_alert': {
        const parsed: TripOccupancyAlertDueEventV1 =
          parseTripOccupancyAlertDueEventV1(row);
        if (!deps.loadTripAgencyIds) {
          return {
            ok: false,
            outcome: {
              kind: 'failed',
              permanent: true,
              reason: 'loadTripAgencyIds is required for occupancy alerts',
            },
          };
        }

        const agencyIds = await deps.loadTripAgencyIds(parsed.data.trip_id);
        const route = await deps.loadRoute(parsed.data.route_id);
        const origin = route?.origin ?? '?';
        const destination = route?.destination ?? '?';
        const departureFormatted = deps.formatDeparture(
          parsed.data.departure_time,
        );
        const live = deps.loadLiveOccupancy
          ? await deps.loadLiveOccupancy(parsed.data.trip_id)
          : null;
        const occupancyPct = live?.occupancy_pct ?? parsed.data.occupancy_pct;
        const reserved = live?.reserved;
        const total = live?.total;
        const isNearFull = parsed.data.alert_type === 'near_full';
        const title = isNearFull ? 'Viaje casi lleno' : 'Viaje subocupado';
        const counts =
          reserved !== undefined && total !== undefined
            ? ` · ${occupancyPct}% (${reserved}/${total})`
            : ` · ${occupancyPct}%`;
        const body = `${origin} → ${destination} el ${departureFormatted}${counts}`;
        const metadata = {
          alert_type: parsed.data.alert_type,
          occupancy_pct: occupancyPct,
          trip_id: parsed.data.trip_id,
        };

        const rows: NotificationFanoutInsertRow[] = [];
        for (const agencyId of agencyIds) {
          rows.push({
            type: 'occupancy_alert',
            title,
            body,
            entity_type: 'trip',
            entity_id: parsed.data.trip_id,
            agency_id: agencyId,
            recipient_role: 'agency',
            action_url: `/agency/trips/${parsed.data.trip_id}/passengers`,
            metadata,
            source_event_id: row.id,
          });
        }
        rows.push({
          type: 'occupancy_alert',
          title,
          body,
          entity_type: 'trip',
          entity_id: parsed.data.trip_id,
          agency_id: null,
          recipient_role: 'superadmin',
          action_url: `/admin/trips/${parsed.data.trip_id}`,
          metadata,
          source_event_id: row.id,
        });

        return { ok: true, rows };
      }
      default: {
        const _exhaustive: never = event;
        return {
          ok: false,
          outcome: {
            kind: 'failed',
            permanent: true,
            reason: `Unsupported notification fanout event: ${_exhaustive}`,
          },
        };
      }
    }
  } catch (err) {
    return {
      ok: false,
      outcome: {
        kind: 'failed',
        permanent: true,
        reason: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * WKR-007 C4 — NotificationFanout for reservation.created + trip.* lifecycle.
 * Gated by TRIP_EFFECTS_VIA_OUTBOX (default false → skipped_effect_disabled).
 */
export function createNotificationFanoutHandler(
  event: NotificationFanoutEvent,
  deps: NotificationFanoutDeps = createDefaultNotificationFanoutDeps(),
): OutboxHandler {
  return async function handleNotificationFanout(
    row: OutboxEventRow,
  ): Promise<HandlerOutcome> {
    if (!deps.isEffectsEnabled()) {
      return { kind: 'completed', reason: 'skipped_effect_disabled' };
    }

    const built = await buildRowsForEvent(row, deps, event);
    if (!built.ok) return built.outcome;

    let filtered: NotificationFanoutInsertRow[];
    try {
      filtered = await deps.filterAgencyNotificationRows(built.rows);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (filtered.length === 0) {
      return { kind: 'completed', reason: 'delivered' };
    }

    let existing: Array<{ agency_id: string | null; recipient_role: string }>;
    try {
      existing = await deps.findExistingBySourceEventId(row.id);
    } catch (err) {
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    const existingKeys = new Set(
      existing.map((r) => recipientKey(r.agency_id, r.recipient_role)),
    );
    const toInsert = filtered.filter(
      (r) => !existingKeys.has(recipientKey(r.agency_id, r.recipient_role)),
    );

    if (toInsert.length === 0) {
      return { kind: 'completed', reason: 'already_delivered' };
    }

    try {
      const { error } = await deps.insertNotificationRows(toInsert);
      if (error) {
        if (error.code === '23505') {
          return { kind: 'completed', reason: 'already_delivered' };
        }
        return {
          kind: 'failed',
          permanent: false,
          reason: error.message,
        };
      }
      return { kind: 'completed', reason: 'delivered' };
    } catch (err) {
      return {
        kind: 'failed',
        permanent: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
