import type { RealtimePostgresChangesPayload, RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type CleanupFn = () => void;

/** Suscribirse a cambios en la tabla `seats` filtrado por trip_id */
export function subscribeToSeats(
  tripId: string,
  onUpdate: (seat: Record<string, any>) => void,
): CleanupFn {
  if (!tripId) return () => {};
  const supabase = createClient();

  const channel = supabase
    .channel(`seats:trip_id=eq.${tripId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'seats',
        filter: `trip_id=eq.${tripId}`,
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        if (payload.new && payload.new.seat_code) {
          onUpdate(payload.new);
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

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
  onInsert: (log: Record<string, any>) => void,
  tripId?: string,
): CleanupFn {
  const supabase = createClient();

  const channelName = tripId
    ? `boarding_logs:trip_id=eq.${tripId}`
    : 'boarding_logs:all';

  const filter = tripId ? `trip_id=eq.${tripId}` : undefined;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'boarding_logs',
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

/** Suscribirse a asignaciones de viajes (trip_agencies INSERT) */
export function subscribeToTripAgencies(
  onInsert: (ta: Record<string, any>) => void,
): CleanupFn {
  const supabase = createClient();

  const channel = supabase
    .channel('trip_agencies:all')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'trip_agencies',
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
