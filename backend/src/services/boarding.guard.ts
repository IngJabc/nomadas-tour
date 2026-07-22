import { supabaseAdmin } from '../config/database.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../errors/index.js';

export interface BoardingContext {
  tripId: string;
  agencyId: string;
}

export async function validateBoardingAllowed(ctx: BoardingContext): Promise<void> {
  const { tripId, agencyId } = ctx;

  const { data: trip, error: tripErr } = await supabaseAdmin
    .from('trips')
    .select('status, departure_time')
    .eq('id', tripId)
    .single();

  if (tripErr || !trip) throw new NotFoundError('Viaje no encontrado');

  if (trip.status === 'cancelled') {
    throw new ValidationError('Este viaje fue cancelado. No es posible realizar boarding.');
  }

  if (trip.status === 'completed') {
    throw new ValidationError('Este viaje ya fue completado. No es posible realizar boarding.');
  }

  if (new Date(trip.departure_time) > new Date()) {
    throw new ValidationError('Este viaje aún no ha salido. No es posible realizar boarding.');
  }

  const { data: assignment } = await supabaseAdmin
    .from('trip_agencies')
    .select('id')
    .eq('trip_id', tripId)
    .eq('agency_id', agencyId)
    .maybeSingle();

  if (!assignment) {
    throw new ForbiddenError('Tu agencia no está asignada a este viaje');
  }
}
