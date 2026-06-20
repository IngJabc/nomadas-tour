'use client';

import { useState } from 'react';
import { Route } from '@/types';

interface TripFormData {
  route_id: string;
  departure_at: string;
  price: number;
  total_seats: number;
  decks: number;
}

interface TripFormProps {
  routes: Route[];
  onSubmit: (data: TripFormData) => Promise<void>;
  initialData?: TripFormData;
}

export function TripForm({ routes, onSubmit, initialData }: TripFormProps) {
  const [routeId, setRouteId] = useState(initialData?.route_id ?? '');
  const [departureAt, setDepartureAt] = useState(initialData?.departure_at ?? '');
  const [price, setPrice] = useState(initialData?.price?.toString() ?? '');
  const [totalSeats, setTotalSeats] = useState(initialData?.total_seats?.toString() ?? '30');
  const [decks, setDecks] = useState(initialData?.decks?.toString() ?? '1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputStyle = {
    border: '1.5px solid #e5e7eb',
    borderRadius: 10,
    padding: '10px 14px',
    fontFamily: 'var(--font-sans)',
    fontWeight: 400 as const,
    fontSize: 14,
    color: 'var(--color-brand-navy)',
    background: '#ffffff',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    transition: 'border-color 200ms, box-shadow 200ms',
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = 'var(--color-brand-cyan)';
    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(8,142,184,0.12)';
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = '#e5e7eb';
    e.currentTarget.style.boxShadow = 'none';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!routeId || !departureAt || !price) {
      setError('Complete todos los campos');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onSubmit({
        route_id: routeId,
        departure_at: departureAt,
        price: Number(price),
        total_seats: Number(totalSeats),
        decks: Number(decks),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex items-center gap-3 mb-4">
        <div style={{ width: 4, height: 18, background: 'var(--color-brand-cyan)', borderRadius: 2 }} />
        <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16, color: 'var(--color-brand-navy)' }}>
          {initialData ? 'Editar viaje' : 'Nuevo viaje'}
        </h2>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block mb-1"
            style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            Ruta
          </label>
          <select
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
            style={inputStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
          >
            <option value="">Seleccione una ruta</option>
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.origin} → {route.destination}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-[200px]">
          <label className="block mb-1"
            style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            Fecha y hora de salida
          </label>
          <input
            type="datetime-local"
            value={departureAt}
            onChange={(e) => setDepartureAt(e.target.value)}
            style={inputStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </div>

        <div className="flex-1 min-w-[200px]">
          <label className="block mb-1"
            style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            Precio por asiento (EUR)
          </label>
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Ej. 25"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={inputStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </div>

        <div className="flex-1 min-w-[200px]">
          <label className="block mb-1"
            style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            Total de asientos
          </label>
          <input
            type="number"
            min="4"
            max="100"
            placeholder="30"
            value={totalSeats}
            onChange={(e) => setTotalSeats(e.target.value)}
            style={inputStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
        </div>

        <div className="flex-1 min-w-[200px]">
          <label className="block mb-1"
            style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            Pisos
          </label>
          <select
            value={decks}
            onChange={(e) => setDecks(e.target.value)}
            style={inputStyle}
            onFocus={handleFocus}
            onBlur={handleBlur}
          >
            <option value="1">1 piso</option>
            <option value="2">2 pisos</option>
          </select>
          {Number(decks) > 1 && (
            <p className="mt-1" style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--color-brand-muted)' }}>
              Por ahora se muestra el layout del primer piso
            </p>
          )}
        </div>

        <div className="shrink-0">
          <button
            type="submit"
            disabled={loading}
            style={{
              background: 'var(--color-brand-navy)',
              color: '#ffffff',
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: 14,
              padding: '10px 24px',
              borderRadius: 10,
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.4 : 1,
              transition: 'background 200ms',
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = 'var(--color-brand-blue)'; }}
            onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = 'var(--color-brand-navy)'; }}
          >
            {loading ? 'Guardando...' : initialData ? 'Actualizar' : 'Crear'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3" style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: '#ef4444' }}>{error}</p>
      )}
    </form>
  );
}
