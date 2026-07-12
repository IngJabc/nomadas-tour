"use client";

import { TripCard } from './TripCard';

export function TripsListClient({ trips }: { trips: any[] }) {
  return (
    <div className="flex flex-col gap-4">
      {trips.map((t) => {
        const trip = {
          id: t.id,
          origin: t.routes?.origin ?? t.route?.origin ?? '—',
          destination: t.routes?.destination ?? t.route?.destination ?? '—',
          departure_at: t.departure_time ?? t.departure_at,
          duration_minutes: 0,
          total_seats: t.capacity ?? t.total_seats ?? 30,
          available_seats: t.available_seats ?? 0,
        };

        return <TripCard key={trip.id} trip={trip} />;
      })}
    </div>
  );
}
