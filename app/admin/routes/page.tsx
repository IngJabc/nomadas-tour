'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Route } from '@/types';
import Link from 'next/link';

export default function AdminRoutesPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
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
    if (!confirm('¿Eliminar esta ruta?')) return;
    await supabase.from('routes').delete().eq('id', routeId);
    fetchRoutes();
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-6 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-800">Rutas</h1>
          <Link
            href="/admin"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300"
          >
            Panel
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <form onSubmit={handleCreate} className="bg-white rounded-xl p-6 shadow-md mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Nueva ruta</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input
              type="text"
              placeholder="Origen"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="Destino"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Duración (min)"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Crear
              </button>
            </div>
          </div>
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        </form>

        <div className="bg-white rounded-xl shadow-md">
          {routes.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No hay rutas registradas</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-600">Origen</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">Destino</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">Duración</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((route) => (
                  <tr key={route.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">{route.origin}</td>
                    <td className="py-3 px-4">{route.destination}</td>
                    <td className="py-3 px-4">{route.duration_minutes} min</td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => handleDelete(route.id)}
                        className="px-3 py-1 text-xs font-medium text-red-600 bg-red-100 rounded-lg hover:bg-red-200"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
