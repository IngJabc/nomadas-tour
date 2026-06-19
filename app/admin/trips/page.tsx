'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { TripTable } from '@/components/admin/TripTable';
import { Trip } from '@/types';
import Link from 'next/link';

export default function AdminTripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const fetchTrips = async () => {
      const { data } = await supabase
        .from('trips')
        .select('*, route:routes(*)')
        .order('departure_at', { ascending: false });

      if (data) setTrips(data as Trip[]);
      setLoading(false);
    };

    fetchTrips();
  }, [supabase]);

  const handleEdit = (trip: Trip) => {
    router.push(`/admin/trips/${trip.id}`);
  };

  const handleDelete = async (tripId: string) => {
    if (!confirm('¿Eliminar este viaje?')) return;
    await supabase.from('trips').delete().eq('id', tripId);
    setTrips((prev) => prev.filter((t) => t.id !== tripId));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-6 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-800">Viajes</h1>
          <div className="flex gap-3">
            <Link
              href="/admin/trips/new"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              Nuevo viaje
            </Link>
            <Link
              href="/admin"
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300"
            >
              Panel
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {trips.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No hay viajes registrados</p>
        ) : (
          <div className="bg-white rounded-xl shadow-md">
            <TripTable trips={trips} onEdit={handleEdit} onDelete={handleDelete} />
          </div>
        )}
      </main>
    </div>
  );
}
