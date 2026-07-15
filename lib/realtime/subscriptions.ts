import type { RealtimePostgresChangesPayload, RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type CleanupFn = () => void;

/** Suscribirse a cambios en `seats` para múltiples viajes */
export function subscribeToTripSeats(
  tripIds: string[],
  onSeatUpdate: (seat: Record<string, any>) => void,
): CleanupFn {
  if (!tripIds.length) return () => {};
  const supabase = createClient();

  const filter = `trip_id=in.(${tripIds.join(',')})`;
  const channelName = `seats:trip_id=in.(${tripIds.join(',')})`;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'seats',
        filter,
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        if (payload.new && payload.new.seat_code) {
          onSeatUpdate(payload.new);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Suscribirse a cambios en la tabla `reservations` */
export function subscribeToReservations(
  onEvent: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; reservation: Record<string, any> }) => void,
  agencyId?: string,
): CleanupFn {
  const supabase = createClient();

  const channelName = agencyId
    ? `reservations:agency_id=eq.${agencyId}`
    : 'reservations:all';

  const filter = agencyId ? `agency_id=eq.${agencyId}` : undefined;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'reservations',
        filter,
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        onEvent({
          eventType: payload.eventType,
          reservation: payload.new || payload.old,
        });
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Suscribirse a cambios en la tabla `reservation_passengers` */
export function subscribeToReservationPassengers(
  onEvent: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; passenger: Record<string, any> }) => void,
): CleanupFn {
  const supabase = createClient();

  const channel = supabase
    .channel('reservation_passengers:all')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'reservation_passengers',
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        onEvent({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          passenger: payload.new || payload.old,
        });
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Suscribirse a cambios en la tabla `trips` */
export function subscribeToTrips(
  onUpdate: (trip: Record<string, any>) => void,
): CleanupFn {
  const supabase = createClient();

  const channel = supabase
    .channel('trips:all')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'trips',
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        if (payload.new) {
          onUpdate(payload.new);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Suscribirse a cambios en `boarding_logs` */
export function subscribeToBoardingLogs(
  onEvent: (log: Record<string, any>) => void,
  tripId?: string,
  agencyId?: string,
): CleanupFn {
  const supabase = createClient();

  const parts: string[] = [];
  if (tripId) parts.push(`trip_id=eq.${tripId}`);
  if (agencyId) parts.push(`scanned_by_agency_id=eq.${agencyId}`);

  const channelName = parts.length
    ? `boarding_logs:${parts.join(',')}`
    : 'boarding_logs:all';

  const filter = parts.length ? parts.join(',') : undefined;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'boarding_logs',
        filter,
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        if (payload.new) {
          onEvent(payload.new);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Suscribirse a cambios en la tabla `routes` */
export function subscribeToRoutes(
  onEvent: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; route: Record<string, any> }) => void,
): CleanupFn {
  const supabase = createClient();

  const channel = supabase
    .channel('routes:all')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'routes',
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        onEvent({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          route: payload.new || payload.old,
        });
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Suscribirse a cambios en la tabla `agencies` (INSERT y UPDATE) */
export function subscribeToAgencies(
  onEvent: (payload: { eventType: 'INSERT' | 'UPDATE'; agency: Record<string, any> }) => void,
): CleanupFn {
  const supabase = createClient();

  const channel = supabase
    .channel('agencies:all')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'agencies',
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        if (payload.new) {
          onEvent({ eventType: 'INSERT', agency: payload.new });
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'agencies',
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        if (payload.new) {
          onEvent({ eventType: 'UPDATE', agency: payload.new });
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Suscribirse a asignaciones de viajes (trip_agencies INSERT) */
export function subscribeToTripAgencies(
  onInsert: (ta: Record<string, any>) => void,
  agencyId?: string,
): CleanupFn {
  const supabase = createClient();

  const channelName = agencyId
    ? `trip_agencies:agency_id=eq.${agencyId}`
    : 'trip_agencies:all';

  const filter = agencyId ? `agency_id=eq.${agencyId}` : undefined;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'trip_agencies',
        filter,
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        if (payload.new) {
          onInsert(payload.new);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
