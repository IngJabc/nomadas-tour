'use client';

import { useEffect, useState } from 'react';
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
      <div className="flex items-center justify-center min-h-screen" style={{ background: '#f1f5f9' }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-navy" />
      </div>
    );
  }

  return (
    <div style={{ background: '#f1f5f9', minHeight: '100vh' }}>
      <div className="max-w-7xl mx-auto" style={{ padding: '32px 24px' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 12, color: 'var(--color-brand-muted)' }}>
              Admin / Rutas
            </p>
            <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 24, color: 'var(--color-brand-navy)' }}>
              Rutas
            </h1>
          </div>
        </div>

        {/* Inline create form */}
        <form
          onSubmit={handleCreate}
          className="mb-6"
          style={{
            background: '#ffffff',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div style={{ width: 4, height: 18, background: 'var(--color-brand-cyan)', borderRadius: 2 }} />
            <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16, color: 'var(--color-brand-navy)' }}>
              Nueva ruta
            </h2>
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="block mb-1"
                style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                Origen
              </label>
              <input
                type="text"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Ej. Barquisimeto"
                className="w-full"
                style={{
                  border: '1.5px solid #e5e7eb',
                  borderRadius: 10,
                  padding: '10px 14px',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 14,
                  color: 'var(--color-brand-navy)',
                  background: '#ffffff',
                  outline: 'none',
                  transition: 'border-color 200ms, box-shadow 200ms',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-brand-cyan)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(8,142,184,0.12)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#e5e7eb';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block mb-1"
                style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                Destino
              </label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Ej. La Olla"
                className="w-full"
                style={{
                  border: '1.5px solid #e5e7eb',
                  borderRadius: 10,
                  padding: '10px 14px',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 14,
                  color: 'var(--color-brand-navy)',
                  background: '#ffffff',
                  outline: 'none',
                  transition: 'border-color 200ms, box-shadow 200ms',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-brand-cyan)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(8,142,184,0.12)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#e5e7eb';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block mb-1"
                style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                Duración (min)
              </label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="120"
                className="w-full"
                style={{
                  border: '1.5px solid #e5e7eb',
                  borderRadius: 10,
                  padding: '10px 14px',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 14,
                  color: 'var(--color-brand-navy)',
                  background: '#ffffff',
                  outline: 'none',
                  transition: 'border-color 200ms, box-shadow 200ms',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-brand-cyan)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(8,142,184,0.12)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#e5e7eb';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>
            <div className="shrink-0">
              <button
                type="submit"
                style={{
                  background: 'var(--color-brand-navy)',
                  color: '#ffffff',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 600,
                  fontSize: 14,
                  padding: '10px 24px',
                  borderRadius: 10,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 200ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-brand-blue)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-brand-navy)'; }}
              >
                Crear
              </button>
            </div>
          </div>
          {error && (
            <p className="mt-3" style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: '#ef4444' }}>{error}</p>
          )}
        </form>

        {/* Table */}
        {routes.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
              <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 14, color: 'var(--color-brand-muted)' }}>No hay rutas registradas</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th className="text-left" style={{ padding: '12px 20px', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Origen</th>
                    <th className="text-left" style={{ padding: '12px 20px', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Destino</th>
                    <th className="text-left" style={{ padding: '12px 20px', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Duración</th>
                    <th className="text-left" style={{ padding: '12px 20px', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={route.id} style={{ borderBottom: '1px solid #f1f5f9' }}
                      className="hover:bg-[#f8fafc] transition-colors"
                    >
                      <td style={{ padding: '16px 20px', fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 14, color: 'var(--color-brand-navy)' }}>{route.origin}</td>
                      <td style={{ padding: '16px 20px', fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 14, color: 'var(--color-brand-navy)' }}>{route.destination}</td>
                      <td style={{ padding: '16px 20px', fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: 'var(--color-brand-muted)' }}>{route.duration_minutes} min</td>
                      <td style={{ padding: '16px 20px' }}>
                        <button
                          type="button"
                          onClick={() => setDeleteId(route.id)}
                          style={{
                            background: '#fef2f2',
                            color: '#ef4444',
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 600,
                            fontSize: 12,
                            padding: '5px 12px',
                            borderRadius: 8,
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'opacity 150ms',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
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
      </div>

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
