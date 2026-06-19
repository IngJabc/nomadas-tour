import { createServerSupabaseClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AuthNav } from '@/components/ui/AuthNav';
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <header className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← Volver a viajes
          </Link>
          <AuthNav />
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">
            {trip.route?.origin} → {trip.route?.destination}
          </h1>
          <p className="text-gray-500">
            Selecciona tus asientos para este viaje
          </p>
        </div>

        <TripClient tripId={tripId} price={trip.price} totalSeats={trip.total_seats} />
      </div>
    </div>
  );
}
