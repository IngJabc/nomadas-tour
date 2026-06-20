"use client";

import { TripCard } from './TripCard';

export function TripsListClient({ trips }: { trips: any[] }) {
  return (
    <div className="flex flex-col gap-4">
      {trips.map((t) => {
        const trip = {
          id: t.id,
          origin: t.route?.origin ?? '—',
          destination: t.route?.destination ?? '—',
          departure_at: t.departure_at,
          duration_minutes: t.route?.duration_minutes ?? t.duration_minutes ?? 0,
          total_seats: t.total_seats ?? 30,
          available_seats: t.available_seats ?? 0,
          price: typeof t.price === 'number' ? t.price : Number(t.price ?? 0),
        };

        return <TripCard key={trip.id} trip={trip} />;
      })}
    </div>
  );
}
