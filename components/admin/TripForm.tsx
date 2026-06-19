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

      <div className="grid grid-cols-2 gap-4">
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
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Total asientos</label>
          <input
            type="number"
            min="4"
            max="100"
            value={totalSeats}
            onChange={(e) => setTotalSeats(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Pisos</label>
        <select
          value={decks}
          onChange={(e) => setDecks(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="1">1 piso</option>
          <option value="2">2 pisos</option>
        </select>
        {Number(decks) > 1 && (
          <p className="text-xs text-gray-400 mt-1">
            Por ahora se muestra el layout del primer piso
          </p>
        )}
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
