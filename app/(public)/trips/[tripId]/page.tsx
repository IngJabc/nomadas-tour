import { createServerSupabaseClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { TripClient } from './trip-client';

export default async function TripPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: trip } = await supabase
    .from('trips')
    .select('*, route:routes(*)')
    .eq('id', tripId)
    .single();

  if (!trip) notFound();

  return <TripClient tripId={tripId} price={trip.price} totalSeats={trip.total_seats} origin={trip.route?.origin} destination={trip.route?.destination} />;
}
