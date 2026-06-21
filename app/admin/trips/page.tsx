'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Trip } from '@/types';
import Link from 'next/link';
import { format } from 'date-fns';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

const STATUS_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  active: { label: 'Activo', bg: '#ecfdf5', text: '#059669' },
  completed: { label: 'Completado', bg: '#f1f5f9', text: '#6b7280' },
  cancelled: { label: 'Cancelado', bg: '#fef2f2', text: '#ef4444' },
};

function formatPrice(price: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(price);
}

function formatDateTime(dateStr: string) {
  try {
    return format(new Date(dateStr), 'dd/MM/yyyy HH:mm');
  } catch {
    return dateStr;
  }
}

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="mb-6">
          <p className="font-['Poppins',sans-serif] font-normal text-xs text-brand-muted">
            <Link href="/admin" className="text-brand-cyan no-underline hover:underline">Admin</Link>
            {' / Viajes'}
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0">
            <h1 className="font-['Montserrat',sans-serif] font-extrabold text-[22px] sm:text-2xl text-brand-navy">
              Viajes
            </h1>
            <Link
              href="/admin/trips/new"
              className="self-start sm:self-auto bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors duration-200 hover:bg-brand-blue text-center no-underline"
            >
              + Nuevo viaje
            </Link>
          </div>
        </div>

        {/* Content */}
        {trips.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
              <svg className="w-8 h-8 text-brand-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">No hay viajes registrados</p>
            <Link
              href="/admin/trips/new"
              className="mt-4 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-sm no-underline hover:bg-brand-blue transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Crear nuevo viaje
            </Link>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block bg-white rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider whitespace-nowrap">Salida</th>
                      <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider whitespace-nowrap">Ruta</th>
                      <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider whitespace-nowrap">Bus</th>
                      <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider whitespace-nowrap">Precio</th>
                      <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider whitespace-nowrap">Estado</th>
                      <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider whitespace-nowrap">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.map((trip) => {
                      const s = STATUS_STYLES[trip.status] ?? STATUS_STYLES.active;
                      return (
                        <tr key={trip.id} className="hover:bg-slate-50 transition-colors border-b border-slate-100">
                          <td className="px-5 py-4 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy whitespace-nowrap">
                            {formatDateTime(trip.departure_at)}
                          </td>
                          <td className="px-5 py-4 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy whitespace-nowrap">
                            {trip.route?.origin ?? '—'} → {trip.route?.destination ?? '—'}
                          </td>
                          <td className="px-5 py-4 font-['Poppins',sans-serif] font-normal text-[13px] text-brand-muted whitespace-nowrap">
                            {trip.total_seats} asientos
                          </td>
                          <td className="px-5 py-4 font-['Poppins',sans-serif] font-semibold text-sm text-brand-cyan whitespace-nowrap">
                            {formatPrice(trip.price)}
                          </td>
                          <td className="px-5 py-4 whitespace-nowrap">
                            <span
                              className="inline-block font-['Poppins',sans-serif] font-semibold text-[11px] px-[10px] py-[3px] rounded-full"
                              style={{ background: s.bg, color: s.text }}
                            >
                              {s.label}
                            </span>
                          </td>
                          <td className="px-5 py-4 whitespace-nowrap">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => router.push(`/admin/trips/${trip.id}`)}
                                className="font-['Poppins',sans-serif] font-semibold text-xs px-3 py-[5px] rounded-lg border-none cursor-pointer transition-opacity duration-150 hover:opacity-70"
                                style={{ background: '#eff6ff', color: 'var(--color-brand-blue)' }}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteId(trip.id)}
                                className="bg-red-50 text-red-500 font-['Poppins',sans-serif] font-semibold text-xs px-3 py-[5px] rounded-lg border-none cursor-pointer transition-opacity duration-150 hover:opacity-70"
                              >
                                Eliminar
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden flex flex-col gap-3">
              {trips.map((trip) => {
                const s = STATUS_STYLES[trip.status] ?? STATUS_STYLES.active;
                return (
                  <div key={trip.id} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="font-['Montserrat',sans-serif] font-bold text-sm text-brand-navy truncate">
                          {trip.route?.origin ?? '—'} → {trip.route?.destination ?? '—'}
                        </p>
                        <p className="font-['Poppins',sans-serif] font-normal text-[12px] text-brand-muted mt-0.5">
                          {formatDateTime(trip.departure_at)}
                        </p>
                      </div>
                      <span
                        className="shrink-0 inline-block font-['Poppins',sans-serif] font-semibold text-[10px] px-2 py-[3px] rounded-full"
                        style={{ background: s.bg, color: s.text }}
                      >
                        {s.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[12px] font-['Poppins',sans-serif] text-brand-muted mb-3">
                      <span>{trip.total_seats} asientos</span>
                      <span className="font-semibold text-brand-cyan">{formatPrice(trip.price)}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => router.push(`/admin/trips/${trip.id}`)}
                        className="flex-1 font-['Poppins',sans-serif] font-semibold text-[12px] px-3 py-3 rounded-xl border-none cursor-pointer transition-opacity duration-150 hover:opacity-70"
                        style={{ background: '#eff6ff', color: 'var(--color-brand-blue)' }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteId(trip.id)}
                        className="flex-1 bg-red-50 text-red-500 font-['Poppins',sans-serif] font-semibold text-[12px] px-3 py-3 rounded-xl border-none cursor-pointer transition-opacity duration-150 hover:opacity-70"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

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
