import type { RealtimePostgresChangesPayload, RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

export type CleanupFn = () => void;

/** Suscribirse a cambios en `seats` para múltiples viajes */
export function subscribeToTripSeats(
  tripIds: string[],
  onSeatUpdate: (payload: { eventType: string; seat: Record<string, any>; old: Record<string, any> | null }) => void,
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
        if (payload.eventType === 'DELETE') {
          if (payload.old?.trip_id) {
            onSeatUpdate({ eventType: 'DELETE', seat: payload.old, old: null });
          }
        } else if (payload.new?.seat_code) {
          onSeatUpdate({ eventType: payload.eventType, seat: payload.new, old: payload.old ?? null });
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
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') {
        console.warn('[Realtime] Reservations channel not SUBSCRIBED — status:', status);
      }
    });

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
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') {
        console.warn('[Realtime] Reservation passengers channel not SUBSCRIBED — status:', status);
      }
    });

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
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') {
        console.warn('[Realtime] Boarding logs channel not SUBSCRIBED — status:', status);
      }
    });

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

/** Agency wizard: subscribe to `link_data` updates on one reservation_link. Public page stays without realtime. */
export function subscribeToReservationLink(
  linkId: string,
  onUpdate: (row: Record<string, any>) => void,
): CleanupFn {
  if (!linkId) return () => {};
  const supabase = createClient();
  const channelName = `reservation_links:id=eq.${linkId}`;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'reservation_links',
        filter: `id=eq.${linkId}`,
      },
      (payload: RealtimePostgresChangesPayload<any>) => {
        if (payload.new) onUpdate(payload.new);
      },
    )
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') {
        console.warn('[Realtime] Reservation link channel not SUBSCRIBED — status:', status);
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================================
// RT-06 — Realtime de pagos/compras del módulo de agencia
// (/agency/payments: listado, detalle de pago y detalle de compra).
// ============================================================

/**
 * RT-06: notificación SIN payload. El backend es la autoridad del estado
 * derivado (estado de compra/pago, verified_at, rechazos): ante CUALQUIER
 * evento el caller re-consulta la API correspondiente en lugar de
 * interpretar la fila cruda del canal.
 */
export type AgencyPaymentsChangeCallback = () => void;

/**
 * RT-06: estado de conexión de un canal. `true` = SUBSCRIBED;
 * `false` = CHANNEL_ERROR / TIMED_OUT / CLOSED. La vista degrada y ofrece
 * actualización manual cuando algún canal reporta `false`.
 */
export type RealtimeConnectionCallback = (connected: boolean) => void;

/**
 * Crea un canal `postgres_changes` de solo-notificación sobre una tabla
 * del módulo de pagos de agencia.
 *
 * El `filter` (agency_id / id) es SOLO rendimiento: la autorización real
 * es RLS (policy 094 `*_agency_read`, espejo de `authorize('agency')` del
 * backend). Sin policy, el evento simplemente no se entrega aunque el
 * filtro del cliente casara; con policy ajena, RLS lo descarta.
 */
function subscribeToAgencyPaymentsTable(
  table: string,
  filter: string | null,
  onChange: AgencyPaymentsChangeCallback,
  onStatus?: RealtimeConnectionCallback,
): CleanupFn {
  const supabase = createClient();
  const channelName = `rt06:${table}:${filter ?? '*'}`;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        ...(filter ? { filter } : {}),
      },
      () => onChange(),
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        onStatus?.(true);
        return;
      }
      console.warn(`[Realtime] RT-06 ${channelName} not SUBSCRIBED — status:`, status);
      onStatus?.(false);
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * RT-06: compras (checkout_attempts) de la agencia autenticada.
 *
 * - `attemptId`: detalle de una compra (`id=eq.<attempt>`).
 * - `agencyId` (sin attemptId): listado de la agencia
 *   (`agency_id=eq.<agency>`).
 * - Sin opciones: cualquier fila visible para la sesión (RLS 094 manda).
 *
 * Sin payload a propósito: el caller re-consulta
 * `agencyApi.listCheckoutAttempts` / `getCheckoutAttempt`.
 */
export function subscribeToAgencyCheckoutAttempts(
  onChange: AgencyPaymentsChangeCallback,
  options?: {
    agencyId?: string;
    attemptId?: string;
    onStatus?: RealtimeConnectionCallback;
  },
): CleanupFn {
  const filter = options?.attemptId
    ? `id=eq.${options.attemptId}`
    : options?.agencyId
      ? `agency_id=eq.${options.agencyId}`
      : null;
  return subscribeToAgencyPaymentsTable(
    'checkout_attempts',
    filter,
    onChange,
    options?.onStatus,
  );
}

/**
 * RT-06: pagos (payments) de la agencia autenticada.
 *
 * - `paymentId`: detalle de un pago (`id=eq.<payment>`).
 * - `agencyId` (sin paymentId): listado de la agencia
 *   (`agency_id=eq.<agency>`).
 * - Sin opciones: cualquier fila visible para la sesión (RLS 094 manda).
 *
 * `payment_allocations` NO se suscribe: un UPDATE de `payments` dispara la
 * re-consulta del caller, que recarga allocations y pasajeros con el resto
 * del DTO.
 */
export function subscribeToAgencyPayments(
  onChange: AgencyPaymentsChangeCallback,
  options?: {
    agencyId?: string;
    paymentId?: string;
    onStatus?: RealtimeConnectionCallback;
  },
): CleanupFn {
  const filter = options?.paymentId
    ? `id=eq.${options.paymentId}`
    : options?.agencyId
      ? `agency_id=eq.${options.agencyId}`
      : null;
  return subscribeToAgencyPaymentsTable(
    'payments',
    filter,
    onChange,
    options?.onStatus,
  );
}

/**
 * RT-06 (detalle de pago): la reserva vinculada. Cambios de estado o de
 * `payment_status` que no tocan `payments` (p. ej. cancelación T-1 del
 * worker) deben refrescar el detalle aunque no exista evento de pago.
 * `reservation_id` está disponible una vez cargó el primer detalle; ya
 * estaba publicada (006/012) con policy `reservations_agency_read` (039).
 */
export function subscribeToAgencyPaymentReservation(
  reservationId: string,
  onChange: AgencyPaymentsChangeCallback,
  onStatus?: RealtimeConnectionCallback,
): CleanupFn {
  if (!reservationId) return () => {};
  return subscribeToAgencyPaymentsTable(
    'reservations',
    `id=eq.${reservationId}`,
    onChange,
    onStatus,
  );
}

/**
 * RT-06 (detalle de pago): pasajeros de la reserva vinculada (badges de
 * estado y totales del DTO). Misma cadena que la reserva: publicada desde
 * 006/012 con policy `rp_agency_read` (039); RLS limita la entrega a los
 * pasajeros de reservas propias de la agencia.
 */
export function subscribeToAgencyPaymentPassengers(
  reservationId: string,
  onChange: AgencyPaymentsChangeCallback,
  onStatus?: RealtimeConnectionCallback,
): CleanupFn {
  if (!reservationId) return () => {};
  return subscribeToAgencyPaymentsTable(
    'reservation_passengers',
    `reservation_id=eq.${reservationId}`,
    onChange,
    onStatus,
  );
}
