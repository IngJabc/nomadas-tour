import { supabaseAdmin } from '../config/database.js';
import { ConflictError, ValidationError } from '../errors/index.js';
import { toUTC } from '../utils/timezone.js';

export const DUPLICATE_TRIP_MESSAGE =
  'Ya existe un viaje programado para esta ruta en la fecha y hora seleccionadas.';

export async function assertNoDuplicateTrip(
  routeId: string,
  departureTime: string,
  excludeTripId?: string,
): Promise<void> {
  const normalizedDeparture = toUTC(departureTime);

  let query = supabaseAdmin
    .from('trips')
    .select('id')
    .eq('route_id', routeId)
    .eq('departure_time', normalizedDeparture);

  if (excludeTripId) {
    query = query.neq('id', excludeTripId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) throw new ValidationError(error.message);
  if (data) throw new ConflictError(DUPLICATE_TRIP_MESSAGE);
}
