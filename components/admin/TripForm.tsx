'use client';

import { useState } from 'react';
import { Route } from '@/types';

interface TripFormProps {
  routes: Route[];
  onSubmit: (data: { route_id: string; departure_at: string; price: number }) => Promise<void>;
  initialData?: { route_id: string; departure_at: string; price: number };
}

export function TripForm({ routes, onSubmit, initialData }: TripFormProps) {
  const [routeId, setRouteId] = useState(initialData?.route_id ?? '');
  const [departureAt, setDepartureAt] = useState(initialData?.departure_at ?? '');
  const [price, setPrice] = useState(initialData?.price?.toString() ?? '');
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
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Ruta</label>
        <select
          value={routeId}
          onChange={(e) => setRouteId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Seleccione una ruta</option>
          {routes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.origin} → {route.destination}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Fecha y hora de salida</label>
        <input
          type="datetime-local"
          value={departureAt}
          onChange={(e) => setDepartureAt(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Precio (COP)</label>
        <input
          type="number"
          min="0"
          step="100"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Guardando...' : initialData ? 'Actualizar viaje' : 'Crear viaje'}
      </button>
    </form>
  );
}
