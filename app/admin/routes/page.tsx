'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Route } from '@/types';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

export default function AdminRoutesPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [duration, setDuration] = useState('');
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const fetchRoutes = async () => {
    const { data } = await supabase.from('routes').select('*').order('origin');
    if (data) setRoutes(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchRoutes();
  }, [supabase]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!origin.trim() || !destination.trim() || !duration) {
      setError('Complete todos los campos');
      return;
    }

    const { error: insertError } = await supabase.from('routes').insert({
      origin: origin.trim(),
      destination: destination.trim(),
      duration_minutes: Number(duration),
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setOrigin('');
    setDestination('');
    setDuration('');
    setError(null);
    fetchRoutes();
  };

  const handleDelete = async (routeId: string) => {
    setDeleteId(null);
    await supabase.from('routes').delete().eq('id', routeId);
    fetchRoutes();
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
          <div>
            <p className="font-['Poppins',sans-serif] font-normal text-xs text-brand-muted">
              <Link href="/admin" className="text-brand-cyan no-underline hover:underline">Admin</Link>
              {' / Rutas'}
            </p>
            <h1 className="font-['Montserrat',sans-serif] font-extrabold text-[22px] sm:text-2xl text-brand-navy">
              Rutas
            </h1>
          </div>
        </div>

        {/* Inline create form */}
        <form
          onSubmit={handleCreate}
          className="mb-6 bg-white rounded-2xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-[18px] bg-brand-cyan rounded-sm" />
            <h2 className="font-['Montserrat',sans-serif] font-bold text-base text-brand-navy">
              Nueva ruta
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-end">
            <div className="flex-1 min-w-0 sm:min-w-[180px]">
              <label className="block mb-1 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
                Origen
              </label>
              <input
                type="text"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Ej. Barquisimeto"
                className="w-full border-[1.5px] border-gray-200 rounded-xl px-3.5 py-2.5 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy bg-white outline-none transition-all duration-200 focus:border-brand-cyan focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]"
              />
            </div>
            <div className="flex-1 min-w-0 sm:min-w-[180px]">
              <label className="block mb-1 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
                Destino
              </label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Ej. La Olla"
                className="w-full border-[1.5px] border-gray-200 rounded-xl px-3.5 py-2.5 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy bg-white outline-none transition-all duration-200 focus:border-brand-cyan focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]"
              />
            </div>
            <div className="flex-1 min-w-0 sm:min-w-[140px]">
              <label className="block mb-1 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
                Duración (min)
              </label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="120"
                className="w-full border-[1.5px] border-gray-200 rounded-xl px-3.5 py-2.5 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy bg-white outline-none transition-all duration-200 focus:border-brand-cyan focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]"
              />
            </div>
            <div className="shrink-0">
              <button
                type="submit"
                className="w-full sm:w-auto bg-brand-navy text-white font-['Poppins',sans-serif] font-semibold text-sm px-6 py-2.5 rounded-xl border-none cursor-pointer transition-colors duration-200 hover:bg-brand-blue"
              >
                Crear
              </button>
            </div>
          </div>
          {error && (
            <p className="mt-3 font-['Poppins',sans-serif] font-normal text-[13px] text-red-500">{error}</p>
          )}
        </form>

        {/* Table */}
        {routes.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
              <svg className="w-8 h-8 text-brand-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <p className="font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">No hay rutas registradas</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left px-3 sm:px-5 py-3 font-['Poppins',sans-serif] font-semibold text-[10px] sm:text-xs text-brand-muted uppercase tracking-wider whitespace-nowrap">Origen</th>
                    <th className="text-left px-3 sm:px-5 py-3 font-['Poppins',sans-serif] font-semibold text-[10px] sm:text-xs text-brand-muted uppercase tracking-wider whitespace-nowrap">Destino</th>
                    <th className="text-left px-3 sm:px-5 py-3 font-['Poppins',sans-serif] font-semibold text-[10px] sm:text-xs text-brand-muted uppercase tracking-wider whitespace-nowrap">Duración</th>
                    <th className="text-left px-3 sm:px-5 py-3 font-['Poppins',sans-serif] font-semibold text-[10px] sm:text-xs text-brand-muted uppercase tracking-wider whitespace-nowrap">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={route.id} className="hover:bg-slate-50 transition-colors border-b border-slate-100">
                      <td className="px-3 sm:px-5 py-3 sm:py-4 font-['Poppins',sans-serif] font-normal text-[12px] sm:text-sm text-brand-navy whitespace-nowrap">{route.origin}</td>
                      <td className="px-3 sm:px-5 py-3 sm:py-4 font-['Poppins',sans-serif] font-normal text-[12px] sm:text-sm text-brand-navy whitespace-nowrap">{route.destination}</td>
                      <td className="px-3 sm:px-5 py-3 sm:py-4 font-['Poppins',sans-serif] font-normal text-[12px] sm:text-[13px] text-brand-muted whitespace-nowrap">{route.duration_minutes} min</td>
                      <td className="px-3 sm:px-5 py-3 sm:py-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setDeleteId(route.id)}
                          className="bg-red-50 text-red-500 font-['Poppins',sans-serif] font-semibold text-[11px] sm:text-xs px-2 sm:px-3 py-1 rounded-lg border-none cursor-pointer transition-opacity duration-150 hover:opacity-70"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <ConfirmModal
          open={deleteId !== null}
          title="Eliminar ruta"
          message="¿Estás seguro de eliminar esta ruta? Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          onConfirm={() => deleteId && handleDelete(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      </div>
  );
}
