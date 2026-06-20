import { createServerSupabaseClient } from '@/lib/supabase/server';
import { TripsListClient } from '@/components/trips/TripsListClient';

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const { data: trips } = await supabase
    .from('trips')
    .select('*, route:routes(*)')
    .eq('status', 'active')
    .order('departure_at', { ascending: true });

  // Compute real available seats per trip
  let tripsWithAvailability: any[] = [];

  if (trips && trips.length > 0) {
    const tripIds = trips.map((t: any) => t.id);
    const { data: allSeats } = await supabase
      .from('seats')
      .select('trip_id, status')
      .in('trip_id', tripIds);

    const availableMap: Record<string, number> = {};
    for (const seat of allSeats || []) {
      if (seat.status === 'available') {
        availableMap[seat.trip_id] = (availableMap[seat.trip_id] || 0) + 1;
      }
    }

    tripsWithAvailability = trips.map((t: any) => ({
      ...t,
      available_seats: availableMap[t.id] ?? 0,
    }));
  }

  return (
    <div style={{ background: '#f1f5f9' }} className="min-h-screen">
      <main className="pt-20 max-w-[1100px] mx-auto px-6 py-8">
        <div className="flex items-start gap-3 mb-6">
          <div style={{ width: 4, height: 28, background: 'var(--color-brand-cyan)' }} />
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 28, color: 'var(--color-brand-navy)' }}>Viajes disponibles</h2>
        </div>

        {!trips || trips.length === 0 ? (
          <div className="text-center mt-20">
            <svg className="mx-auto mb-6" width="120" height="80" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="10" y="30" width="80" height="30" rx="6" fill="#e6eef6" />
              <circle cx="30" cy="65" r="6" fill="#cbdffd" />
              <circle cx="70" cy="65" r="6" fill="#cbdffd" />
            </svg>
            <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 18, color: 'var(--color-brand-navy)' }}>No hay viajes disponibles por ahora</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 14, color: 'var(--color-brand-muted)' }}>Vuelve pronto, estamos preparando nuevas rutas</div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* @ts-ignore */}
            <TripsListClient trips={tripsWithAvailability} />
          </div>
        )}
      </main>
    </div>
  );
}
