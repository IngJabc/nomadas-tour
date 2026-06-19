'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { TripForm } from '@/components/admin/TripForm';
import { Route } from '@/types';
import Link from 'next/link';

export default function EditTripPage() {
  const params = useParams();
  const tripId = params.tripId as string;
  const [routes, setRoutes] = useState<Route[]>([]);
  const [initialData, setInitialData] = useState<{
    route_id: string;
    departure_at: string;
    price: number;
    total_seats: number;
    decks: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const fetchData = async () => {
      const [routesRes, tripRes] = await Promise.all([
        supabase.from('routes').select('*'),
        supabase.from('trips').select('*').eq('id', tripId).single(),
      ]);

      if (routesRes.data) setRoutes(routesRes.data);
      if (tripRes.data) {
        setInitialData({
          route_id: tripRes.data.route_id,
          departure_at: new Date(tripRes.data.departure_at)
            .toISOString()
            .slice(0, 16),
          price: tripRes.data.price,
          total_seats: tripRes.data.total_seats,
          decks: tripRes.data.decks,
        });
      }
      setLoading(false);
    };
    fetchData();
  }, [tripId, supabase]);

  const handleSubmit = async (data: {
    route_id: string;
    departure_at: string;
    price: number;
    total_seats: number;
    decks: number;
  }) => {
    const { error } = await supabase
      .from('trips')
      .update({
        route_id: data.route_id,
        departure_at: new Date(data.departure_at).toISOString(),
        price: data.price,
        total_seats: data.total_seats,
        decks: data.decks,
      })
      .eq('id', tripId);

    if (error) throw error;
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
          <h1 className="text-2xl font-bold text-gray-800">Editar viaje</h1>
          <Link
            href="/admin/trips"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300"
          >
            Volver
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {initialData && (
          <TripForm routes={routes} onSubmit={handleSubmit} initialData={initialData} />
        )}
      </main>
    </div>
  );
}
