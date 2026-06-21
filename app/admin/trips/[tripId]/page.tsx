'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { TripForm } from '@/components/admin/TripForm';
import { Route } from '@/types';

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
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-navy" />
      </div>
    );
  }

  return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6">
          <p className="font-['Poppins',sans-serif] font-normal text-xs text-brand-muted">
            <Link href="/admin" className="text-brand-cyan no-underline hover:underline">Admin</Link>
            {' / '}
            <Link href="/admin/trips" className="text-brand-cyan no-underline hover:underline">Viajes</Link>
            {' / Editar'}
          </p>
          <h1 className="font-['Montserrat',sans-serif] font-extrabold text-[22px] sm:text-2xl text-brand-navy mt-1">
            Editar viaje
          </h1>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
          {initialData && (
            <TripForm routes={routes} onSubmit={handleSubmit} initialData={initialData} />
          )}
        </div>
      </div>
  );
}
