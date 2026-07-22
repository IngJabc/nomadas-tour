import { supabaseAdmin } from '../config/database.js';
import { ConflictError, ValidationError } from '../errors/index.js';

/**
 * Snapshot of the operational state of a trip, fetched once
 * and reused across all edit validations.
 */
export interface TripOperationalContext {
  trip: {
    id: string;
    status: string;
    departure_time: string;
    capacity: number;
    vehicle_type: string;
    route_id: string;
  };
  activeReservationCount: number;
  activeReservationsByAgency: Record<string, number>;
  lockedSeatCount: number;
  boardedPassengerCount: number;
  currentAgencyIds: string[];
}

/**
 * Fetches all the operational data needed to validate a trip edit
 * in a minimal set of queries. This avoids scattered queries
 * throughout the validation logic.
 */
export async function getTripOperationalContext(tripId: string): Promise<TripOperationalContext> {
  const { data: trip, error: tripError } = await supabaseAdmin
    .from('trips')
    .select('id, status, departure_time, capacity, vehicle_type, route_id')
    .eq('id', tripId)
    .single();

  if (tripError || !trip) {
    throw new Error('Trip not found');
  }

  // Phase 1: parallel fetch of independent data
  const [reservationsResult, lockedSeatsResult, tripAgenciesResult] = await Promise.all([
    supabaseAdmin
      .from('reservations')
      .select('id, agency_id')
      .eq('trip_id', tripId)
      .in('status', ['confirmed', 'partial']),
    supabaseAdmin
      .from('seats')
      .select('id', { count: 'exact', head: true })
      .eq('trip_id', tripId)
      .eq('status', 'locked'),
    supabaseAdmin
      .from('trip_agencies')
      .select('agency_id')
      .eq('trip_id', tripId),
  ]);

  if (reservationsResult.error) throw new ValidationError(reservationsResult.error.message);
  if (lockedSeatsResult.error) throw new ValidationError(lockedSeatsResult.error.message);
  if (tripAgenciesResult.error) throw new ValidationError(tripAgenciesResult.error.message);

  const activeReservations = reservationsResult.data || [];
  const lockedSeatCount = lockedSeatsResult.count || 0;
  const tripAgencies = tripAgenciesResult.data || [];

  // Phase 2: count boarded passengers across ALL reservations for this trip
  const { data: allReservations } = await supabaseAdmin
    .from('reservations')
    .select('id')
    .eq('trip_id', tripId)
    .in('status', ['confirmed', 'partial', 'completed', 'boarded']);

  const allResIds = (allReservations || []).map(r => r.id);
  let boardedPassengerCount = 0;

  if (allResIds.length > 0) {
    const { count } = await supabaseAdmin
      .from('reservation_passengers')
      .select('id', { count: 'exact', head: true })
      .eq('boarded', true)
      .eq('status', 'active')
      .in('reservation_id', allResIds);
    boardedPassengerCount = count || 0;
  }

  // Aggregate active reservations by agency
  const activeReservationsByAgency: Record<string, number> = {};
  for (const r of activeReservations) {
    activeReservationsByAgency[r.agency_id] = (activeReservationsByAgency[r.agency_id] || 0) + 1;
  }

  return {
    trip: {
      id: trip.id,
      status: trip.status,
      departure_time: trip.departure_time,
      capacity: trip.capacity,
      vehicle_type: trip.vehicle_type,
      route_id: trip.route_id,
    },
    activeReservationCount: activeReservations.length,
    activeReservationsByAgency,
    lockedSeatCount,
    boardedPassengerCount,
    currentAgencyIds: tripAgencies.map(ta => ta.agency_id),
  };
}

/**
 * Validates whether a trip can be edited at all.
 * Blocks editing of completed, cancelled, or departed trips,
 * and trips with active boarding.
 */
export function validateTripEditable(ctx: TripOperationalContext): void {
  if (ctx.trip.status === 'completed') {
    throw new ValidationError('No se puede modificar un viaje completado');
  }

  if (ctx.trip.status === 'cancelled') {
    throw new ValidationError('No se puede modificar un viaje cancelado');
  }

  const now = new Date();
  const departure = new Date(ctx.trip.departure_time);
  if (now >= departure) {
    throw new ValidationError('No se puede modificar un viaje cuya hora de salida ya pasó');
  }

  if (ctx.boardedPassengerCount > 0) {
    throw new ValidationError(
      `No se puede modificar un viaje con ${ctx.boardedPassengerCount} pasajero(s) ya abordado(s)`,
    );
  }
}

/**
 * Validates whether the vehicle type can be changed.
 * Vehicle changes are blocked when there are active reservations,
 * active locks, or boarding activity.
 */
export function validateVehicleChange(
  ctx: TripOperationalContext,
  newVehicleType: string,
): void {
  if (ctx.trip.vehicle_type === newVehicleType) return;

  if (ctx.activeReservationCount > 0) {
    throw new ValidationError(
      `No se puede cambiar el tipo de vehículo: el viaje tiene ${ctx.activeReservationCount} reserva(s) activa(s)`,
    );
  }

  if (ctx.lockedSeatCount > 0) {
    throw new ValidationError(
      `No se puede cambiar el tipo de vehículo: existen ${ctx.lockedSeatCount} asiento(s) bloqueado(s) por agencias en proceso de reserva`,
    );
  }

  if (ctx.boardedPassengerCount > 0) {
    throw new ValidationError(
      'No se puede cambiar el tipo de vehículo: ya hay pasajeros abordados',
    );
  }
}

/**
 * Validates whether an agency can be removed from the trip.
 * Removal is blocked when the agency has active reservations.
 */
export function validateAgencyRemoval(
  ctx: TripOperationalContext,
  newAgencyIds: string[],
): void {
  const removedAgencies = ctx.currentAgencyIds.filter(
    aid => !newAgencyIds.includes(aid),
  );

  for (const agencyId of removedAgencies) {
    const activeCount = ctx.activeReservationsByAgency[agencyId] || 0;
    if (activeCount > 0) {
      throw new ValidationError(
        `No se puede desasignar la agencia: tiene ${activeCount} reserva(s) activa(s) en este viaje. Cancele las reservas primero`,
      );
    }
  }
}

/**
 * Blocks editing a trip that has active reservations.
 * This is a hard gate: any edit attempt (except postpone) is rejected
 * when the trip has confirmed or partial reservations.
 */
export function validateNoActiveReservations(ctx: TripOperationalContext): void {
  if (ctx.activeReservationCount > 0) {
    throw new ConflictError(
      'No se puede editar un viaje con reservas activas. Use las acciones disponibles como posponer o cancelar.',
    );
  }
}
