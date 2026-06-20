'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { TripTable } from '@/components/admin/TripTable';
import { Trip } from '@/types';
import Link from 'next/link';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

export default function AdminTripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
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
    setDeleteId(null);
    await supabase.from('trips').delete().eq('id', tripId);
    setTrips((prev) => prev.filter((t) => t.id !== tripId));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-navy" />
      </div>
    );
  }

  return (
    <div className="bg-slate-100 min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="font-['Poppins',sans-serif] font-normal text-xs text-brand-muted">
              Admin / Viajes
            </p>
            <h1 className="font-['Montserrat',sans-serif] font-extrabold text-2xl text-brand-navy">
              Viajes
            </h1>
          </div>
          <Link
            href="/admin/trips/new"
            className="bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors duration-200 hover:bg-brand-blue"
          >
            + Nuevo viaje
          </Link>
        </div>

        {/* Table */}
        {trips.length === 0 ? (
          <div className="text-center py-16 sm:py-20 bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
              <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">No hay viajes registrados</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <TripTable trips={trips} onEdit={handleEdit} onDelete={(id) => setDeleteId(id)} />
          </div>
        )}
      </div>

      <ConfirmModal
        open={deleteId !== null}
        title="Eliminar viaje"
        message="¿Estás seguro de eliminar este viaje? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        onConfirm={() => deleteId && handleDelete(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
