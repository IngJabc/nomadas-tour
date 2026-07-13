'use client';

import { useEffect, useState } from 'react';
import { Route, Plus, Search, X } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ErrorText } from '@/components/form';

export default function AdminRoutesPage() {
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  const fetchRoutes = async () => {
    try {
      const data = await adminApi.listRoutes();
      setRoutes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar rutas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutes();
  }, []);

  const filteredRoutes = searchInput.trim()
    ? routes.filter((r) =>
        r.origin.toLowerCase().includes(searchInput.toLowerCase()) ||
        r.destination.toLowerCase().includes(searchInput.toLowerCase())
      )
    : routes;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!origin.trim() || !destination.trim()) {
      setError('Complete todos los campos');
      return;
    }

    setCreating(true);
    try {
      await adminApi.createRoute({ origin: origin.trim(), destination: destination.trim() });
      setOrigin('');
      setDestination('');
      setError(null);
      fetchRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear ruta');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (routeId: string) => {
    setDeleteId(null);
    try {
      await adminApi.deleteRoute(routeId);
      fetchRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="h-8 w-32 bg-slate-200 rounded animate-pulse mb-6" />
        <TableSkeleton rows={4} />
      </div>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <PageHeader
        title="Rutas"
      />

      {/* Inline create form */}
      <div className="mb-6 bg-[var(--color-brand-surface)] rounded-2xl p-6 border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <div className="mb-4">
          <SectionTitle>Nueva ruta</SectionTitle>
        </div>

        <form onSubmit={handleCreate}>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-end">
            <div className="flex-1 min-w-0 sm:min-w-[180px]">
              <Input
                label="Origen"
                type="text"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Ej. Barquisimeto"
              />
            </div>
            <div className="flex-1 min-w-0 sm:min-w-[180px]">
              <Input
                label="Destino"
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Ej. La Olla"
              />
            </div>
            <div className="shrink-0">
              <Button type="submit" loading={creating} variant="secondary">
                <Plus className="w-4 h-4" />
                Crear
              </Button>
            </div>
          </div>
          {error && (
            <div className="mt-3">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
        </form>
      </div>

      {/* Search filter */}
      <div className="mb-6">
        <div className="relative w-full">
          <input
            type="text"
            placeholder="Buscar ruta por origen o destino..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full h-9 border-[1.5px] border-[#e5e7eb] rounded-xl pl-8 pr-8 text-xs sm:text-sm font-[family-name:var(--font-body)] font-semibold text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)]"
          />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-brand-muted)]" />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {routes.length === 0 ? (
        <EmptyState
          icon={<Route className="w-8 h-8" />}
          message="No hay rutas registradas"
        />
      ) : filteredRoutes.length === 0 ? (
        <EmptyState
          icon={<Route className="w-8 h-8" />}
          message="No se encontraron rutas con ese criterio de búsqueda"
        />
      ) : (
        <div className="bg-[var(--color-brand-surface)] rounded-2xl overflow-hidden border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-3 sm:px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-[10px] sm:text-xs text-[var(--color-brand-muted)] uppercase tracking-wider whitespace-nowrap">Origen</th>
                  <th className="text-left px-3 sm:px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-[10px] sm:text-xs text-[var(--color-brand-muted)] uppercase tracking-wider whitespace-nowrap">Destino</th>
                  <th className="text-left px-3 sm:px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-[10px] sm:text-xs text-[var(--color-brand-muted)] uppercase tracking-wider whitespace-nowrap">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredRoutes.map((route) => (
                  <tr key={route.id} className="hover:bg-slate-50 transition-colors border-b border-slate-100">
                    <td className="px-3 sm:px-5 py-3 sm:py-4 font-[family-name:var(--font-body)] font-normal text-[12px] sm:text-sm text-[var(--color-brand-navy)] whitespace-nowrap">{route.origin}</td>
                    <td className="px-3 sm:px-5 py-3 sm:py-4 font-[family-name:var(--font-body)] font-normal text-[12px] sm:text-sm text-[var(--color-brand-navy)] whitespace-nowrap">{route.destination}</td>
                    <td className="px-3 sm:px-5 py-3 sm:py-4 whitespace-nowrap">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteId(route.id)}
                      >
                        Eliminar
                      </Button>
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
    </main>
  );
}
