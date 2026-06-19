import { createServerSupabaseClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { formatDateTime, formatPrice } from '@/lib/utils';
import { AuthNav } from '@/components/ui/AuthNav';

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: trips } = await supabase
    .from('trips')
    .select('*, route:routes(*)')
    .eq('status', 'active')
    .order('departure_at', { ascending: true });

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-6 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Camping Cascada del Vino</h1>
            <p className="text-gray-500 mt-1">Reserva tu asiento de autobús</p>
          </div>
          <AuthNav />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">Viajes disponibles</h2>

        {!trips || trips.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No hay viajes disponibles en este momento</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {trips.map((trip) => (
              <Link
                key={trip.id}
                href={`/trips/${trip.id}`}
                className="block bg-white rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">
                      {trip.route?.origin} → {trip.route?.destination}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {formatDateTime(trip.departure_at)}
                    </p>
                    <p className="text-sm text-gray-400">
                      Duración: {trip.route?.duration_minutes} min &middot; {trip.total_seats} asientos{trip.decks > 1 ? ` (${trip.decks} pisos)` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-blue-600">
                      {formatPrice(trip.price)}
                    </p>
                    <p className="text-xs text-gray-400">por asiento</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
