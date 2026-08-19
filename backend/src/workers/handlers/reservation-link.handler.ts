import { supabaseAdmin } from '../../config/database.js';
import { notificationDestinationLabel } from '../../utils/notification-route-label.js';
import { notificationService } from '../../services/notification.service.js';
import {
  parseReservationLinkCancelledEventV1,
  parseReservationLinkConfirmedEventV1,
  parseReservationLinkCreatedEventV1,
  parseReservationLinkSavedEventV1,
} from '../../events/reservation-link.v1.js';
import type { OutboxHandler } from '../outbox/types.js';

async function destinationForTrip(tripId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('trips')
    .select('routes!inner(destination)')
    .eq('id', tripId)
    .maybeSingle();
  const dest = (data as { routes?: { destination?: string } } | null)?.routes?.destination;
  return notificationDestinationLabel(dest);
}

export function createReservationLinkAckHandler(
  kind: 'created' | 'confirmed' | 'cancelled',
): OutboxHandler {
  return async (row) => {
    if (kind === 'created') parseReservationLinkCreatedEventV1(row);
    else if (kind === 'confirmed') parseReservationLinkConfirmedEventV1(row);
    else parseReservationLinkCancelledEventV1(row);
    return { kind: 'completed', reason: 'delivered' };
  };
}

export function createReservationLinkPassengerSavedHandler(): OutboxHandler {
  return async (row) => {
    const parsed = parseReservationLinkSavedEventV1(row);
    const destination = await destinationForTrip(parsed.data.trip_id);
    await notificationService.createForAgency({
      type: 'reservation_link_passenger_data',
      title: 'Datos de pasajero',
      body: `Un pasajero cargó datos para el viaje a ${destination}`,
      entityType: 'reservation_link',
      entityId: parsed.data.link_id,
      agencyId: parsed.data.agency_id,
      actor: 'system',
      action_url: '/agency/trips',
      source_event_id: row.id,
    });
    return { kind: 'completed', reason: 'delivered' };
  };
}
