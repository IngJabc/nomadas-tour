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
    const response = await fetch('/api/admin/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Error al crear viaje');
    }

    router.push('/admin/trips');
    router.refresh();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-brand-surface to-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-navy" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-surface to-white">
      <main className="pt-20 max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="bg-white rounded-2xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
          <TripForm routes={routes} onSubmit={handleSubmit} />
        </div>
      </main>
    </div>
  );
}
