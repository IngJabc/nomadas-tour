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

const inputClass =
  "w-full border-[1.5px] border-gray-200 rounded-xl px-3.5 py-2.5 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy bg-white outline-none transition-all duration-200 focus:border-brand-cyan focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]";

export function TripForm({ routes, onSubmit, initialData }: TripFormProps) {
  const [routeId, setRouteId] = useState(initialData?.route_id ?? '');
  const [departureAt, setDepartureAt] = useState(initialData?.departure_at ?? '');
  const [price, setPrice] = useState(initialData?.price?.toString() ?? '');
  const [totalSeats, setTotalSeats] = useState(initialData?.total_seats?.toString() ?? '30');
  const [decks, setDecks] = useState(initialData?.decks?.toString() ?? '1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <div className="w-1 h-[18px] bg-brand-cyan rounded-sm" />
        <h2 className="font-['Montserrat',sans-serif] font-bold text-base text-brand-navy">
          {initialData ? 'Editar viaje' : 'Nuevo viaje'}
        </h2>
      </div>

      <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-end">
        <div className="flex-1 min-w-0 sm:min-w-[180px]">
          <label className="block mb-1 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
            Ruta
          </label>
          <select
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
            className={inputClass}
          >
            <option value="">Seleccione una ruta</option>
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.origin} → {route.destination}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-0 sm:min-w-[180px]">
          <label className="block mb-1 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
            Fecha y hora de salida
          </label>
          <input
            type="datetime-local"
            value={departureAt}
            onChange={(e) => setDepartureAt(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex-1 min-w-0 sm:min-w-[140px]">
          <label className="block mb-1 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
            Precio (EUR)
          </label>
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Ej. 25"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex-1 min-w-0 sm:min-w-[140px]">
          <label className="block mb-1 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
            Asientos
          </label>
          <input
            type="number"
            min="4"
            max="100"
            placeholder="30"
            value={totalSeats}
            onChange={(e) => setTotalSeats(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex-1 min-w-0 sm:min-w-[120px]">
          <label className="block mb-1 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
            Pisos
          </label>
          <select
            value={decks}
            onChange={(e) => setDecks(e.target.value)}
            className={inputClass}
          >
            <option value="1">1 piso</option>
            <option value="2">2 pisos</option>
          </select>
          {Number(decks) > 1 && (
            <p className="mt-1 font-['Poppins',sans-serif] text-xs text-brand-muted">
              Por ahora se muestra el layout del primer piso
            </p>
          )}
        </div>

        <div className="shrink-0 w-full sm:w-auto">
          <button
            type="submit"
            disabled={loading}
            className="w-full sm:w-auto bg-brand-navy text-white font-['Poppins',sans-serif] font-semibold text-sm px-6 py-2.5 rounded-xl border-none cursor-pointer transition-colors duration-200 hover:bg-brand-blue disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Guardando...' : initialData ? 'Actualizar' : 'Crear'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 font-['Poppins',sans-serif] text-[13px] text-red-500">{error}</p>
      )}
    </form>
  );
}
