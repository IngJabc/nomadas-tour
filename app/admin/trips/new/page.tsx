'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { TripForm } from '@/components/admin/TripForm';
import { Route } from '@/types';
import Link from 'next/link';

export default function NewTripPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const fetchRoutes = async () => {
      const { data } = await supabase.from('routes').select('*');
      if (data) setRoutes(data);
      setLoading(false);
    };
    fetchRoutes();
  }, [supabase]);

  const handleSubmit = async (data: {
    route_id: string;
    departure_at: string;
    price: number;
    total_seats: number;
    decks: number;
  }) => {
    const { error } = await supabase.from('trips').insert({
      route_id: data.route_id,
      departure_at: new Date(data.departure_at).toISOString(),
      price: data.price,
      total_seats: data.total_seats,
      decks: data.decks,
      status: 'active',
    });

    if (error) throw error;

    const { data: trip } = await supabase
      .from('trips')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (trip) {
      const seatCodes = [
        ...Array.from({ length: data.total_seats }, (_, i) => `A${i + 1}`),
        'G',
      ];

      await supabase.from('seats').insert(
        seatCodes.map((code) => ({
          trip_id: trip.id,
          seat_code: code,
          status: code === 'G' ? 'locked' : 'available',
        })),
      );
    }

    router.push('/admin/trips');
    router.refresh();
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-6 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-800">Nuevo viaje</h1>
          <Link
            href="/admin/trips"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300"
          >
            Volver
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <TripForm routes={routes} onSubmit={handleSubmit} />
      </main>
    </div>
  );
}
