import type { RealtimePostgresChangesPayload, RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

export type CleanupFn = () => void;

/** Suscribirse a cambios en `seats` para múltiples viajes */
export function subscribeToTripSeats(
  tripIds: string[],
  onSeatUpdate: (payload: { eventType: string; seat: Record<string, any>; old: Record<string, any> | null }) => void,
): CleanupFn {
  console.log('[RT:subscribeToTripSeats] called with tripIds:', tripIds);
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
        console.log('[RT:raw] event:', payload.eventType, '| new:', payload.new, '| old:', payload.old);
        if (payload.eventType === 'DELETE') {
          if (payload.old?.trip_id) {
            onSeatUpdate({ eventType: 'DELETE', seat: payload.old, old: null });
          } else {
            console.log('[RT:raw] DROPPED (no old.trip_id)');
          }
        } else if (payload.new?.seat_code) {
          onSeatUpdate({ eventType: payload.eventType, seat: payload.new, old: payload.old ?? null });
        } else {
          console.log('[RT:raw] DROPPED (no new.seat_code). new keys:', Object.keys(payload.new || {}));
        }
      },
    )
    .subscribe((status) => {
      console.log('[RT:channel] status:', status, '| channel:', channelName, '| filter:', filter);
    });

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
  onEvent: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; trip: Record<string, any> }) => void,
  tripIds?: string[],
): CleanupFn {
  const supabase = createClient();

  const filter = tripIds && tripIds.length > 0
    ? `id=in.(${tripIds.join(',')})`
    : undefined;

  const channelName = tripIds && tripIds.length > 0
    ? `trips:id=in.(${tripIds.join(',')})`
    : 'trips:all';

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'trips',
        filter,
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        onEvent({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          trip: payload.new || payload.old,
        });
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
  agencyId?: string,
): CleanupFn {
  const supabase = createClient();

  const channelName = agencyId
    ? `agencies:id=eq.${agencyId}`
    : 'agencies:all';

  const filter = agencyId ? `id=eq.${agencyId}` : undefined;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'agencies',
        filter,
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
        filter,
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
  onEvent: (ta: Record<string, any>) => void,
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
        event: '*',
        schema: 'public',
        table: 'trip_agencies',
        filter,
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        onEvent(payload.new || payload.old);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Suscribirse a notificaciones en tiempo real */
export function subscribeToNotifications(
  onEvent: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; notification: Record<string, any> }) => void,
  role: string,
  agencyId?: string,
): CleanupFn {
  const supabase = createClient();

  let filter: string;
  let channelName: string;

  if (role === 'superadmin') {
    filter = 'recipient_role=eq.superadmin';
    channelName = 'notifications:recipient_role=eq.superadmin';
  } else {
    filter = `agency_id=eq.${agencyId}`;
    channelName = `notifications:agency_id=eq.${agencyId}`;
  }

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter,
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        onEvent({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          notification: payload.new || payload.old,
        });
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.error('[RT:notifications] Channel error:', channelName);
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}
