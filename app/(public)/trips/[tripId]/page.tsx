import { notFound } from 'next/navigation';
import { TripClient } from './trip-client';
import { customerApi } from '@/lib/api';

export default async function TripPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;

  let trip: any;
  try {
    trip = await customerApi.getTripWithSeats(tripId);
  } catch {
    notFound();
  }

  if (!trip) notFound();

  return (
    <TripClient
      tripId={tripId}
      vehicleType={trip.vehicle_type}
      origin={trip.routes?.origin}
      destination={trip.routes?.destination}
    />
  );
}
