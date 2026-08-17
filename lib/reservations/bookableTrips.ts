import type { AgencyTripListItem } from '@/types';

type BookableTrip = Pick<
  AgencyTripListItem,
  'status' | 'available_seats' | 'departure_time'
>;

/** Instant comparison; `now` is captured once by the caller. */
export function isDepartureInFuture(
  departureTime: string,
  now: Date,
): boolean {
  const departureMs = new Date(departureTime).getTime();
  if (Number.isNaN(departureMs)) return false;
  return departureMs > now.getTime();
}

export function isTripOpenForReservation(
  trip: BookableTrip,
  now: Date,
): boolean {
  return (
    trip.status === 'active' &&
    trip.available_seats > 0 &&
    isDepartureInFuture(trip.departure_time, now)
  );
}

/**
 * Wizard `/agency/reservations/new` selectable trips.
 * Matches backend 066: departure_time must be strictly after `now`.
 */
export function filterBookableTrips<T extends BookableTrip>(
  trips: T[],
  now: Date,
): T[] {
  return trips.filter((trip) => isTripOpenForReservation(trip, now));
}
