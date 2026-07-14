'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { MapPin, Search, X, Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';

import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { RouteCard, RouteFormModal } from '@/components/admin/routes';
import type { RouteData } from '@/components/admin/routes';
import { adminApi } from '@/lib/api';

const pageFade = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

export default function AdminRoutesPage() {
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingRoute, setEditingRoute] = useState<RouteData | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<RouteData | null>(null);
  const [deactivateLoading, setDeactivateLoading] = useState(false);

  const doFetch = useCallback(async () => {
    try {
      setFetchError(null);
      const data = await adminApi.listRoutes();
      setRoutes(data || []);
    } catch {
      setRoutes([]);
      setFetchError('No se pudieron cargar las rutas. Intenta de nuevo.');
    }
  }, []);

  useEffect(() => {
    doFetch().finally(() => setInitialLoad(false));
  }, [doFetch]);

  const filteredRoutes = useMemo(() => {
    if (!searchFilter.trim()) return routes;
    const q = searchFilter.toLowerCase();
    return routes.filter(
      (r) => r.origin.toLowerCase().includes(q) || r.destination.toLowerCase().includes(q)
    );
  }, [routes, searchFilter]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchFilter(value), 300);
  };

  const handleEnter = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchFilter(searchInput);
  };

  const clearSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchInput('');
    setSearchFilter('');
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const handleOpenCreate = () => { setFormMode('create'); setEditingRoute(null); setFormOpen(true); };
  const handleOpenEdit = (route: RouteData) => {
    if (route.reservationCount > 0) {
      toast.error('No puedes editar esta ruta porque tiene reservas asociadas.');
      return;
    }
    if (route.tripCount > 0) {
      setFormMode('edit');
      setEditingRoute(route);
      setFormOpen(true);
      return;
    }
    setFormMode('edit');
    setEditingRoute(route);
    setFormOpen(true);
  };

  const handleFormSubmit = async (data: { origin: string; destination: string }) => {
    if (formMode === 'create') {
      await adminApi.createRoute(data);
      toast.success('Ruta creada correctamente');
    } else if (editingRoute) {
      await adminApi.updateRoute(editingRoute.id, data);
      toast.success('Ruta actualizada correctamente');
    }
    await doFetch();
  };

  const handleOpenDeactivate = (route: RouteData) => {
    if (route.tripCount > 0) {
      toast.error('No puedes desactivar esta ruta porque tiene viajes activos. Cancela o completa los viajes primero.');
      return;
    }
    setDeactivateTarget(route);
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivateLoading(true);
    try {
      await adminApi.deactivateRoute(deactivateTarget.id);
      toast.success('Ruta desactivada');
      setDeactivateTarget(null);
      await doFetch();
    } catch {
      toast.error('No se pudo desactivar la ruta');
    } finally {
      setDeactivateLoading(false);
    }
  };

  const handleActivate = async (route: RouteData) => {
    try {
      await adminApi.activateRoute(route.id);
      toast.success('Ruta activada');
      await doFetch();
    } catch {
      toast.error('No se pudo activar la ruta');
    }
  };

  if (initialLoad) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="h-8 w-32 bg-slate-200 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => <CardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25 }}
      >
        <PageHeader
          title="Rutas"
          action={
            <Button onClick={handleOpenCreate}>
              <Plus className="w-4 h-4" />
              Nueva ruta
            </Button>
          }
        />
      </motion.div>

      {/* Search */}
      <motion.div
        className="mb-6"
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        <div className="relative w-full sm:w-96">
          <input
            type="text"
            placeholder="Buscar por destino u origen..."
            value={searchInput}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleEnter()}
            className="w-full h-10 border-[1.5px] border-[#e5e7eb] rounded-xl pl-8 pr-8 text-xs sm:text-sm font-[family-name:var(--font-body)] font-normal text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all duration-200"
          />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-brand-muted)]" />
          {searchFilter && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] transition-colors duration-150"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </motion.div>

      {/* Error */}
      {fetchError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
        >
          <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">{fetchError}</p>
          <Button variant="secondary" size="sm" onClick={doFetch}>
            Reintentar
          </Button>
        </motion.div>
      )}

      {/* Content */}
      {routes.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25 }}
        >
          <EmptyState
            icon={<MapPin className="w-8 h-8" />}
            message="No hay rutas registradas"
            action={{ label: 'Crear nueva ruta', onClick: handleOpenCreate }}
          />
        </motion.div>
      ) : filteredRoutes.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25 }}
        >
          <EmptyState
            icon={<Search className="w-8 h-8" />}
            message="No se encontraron rutas con ese criterio de búsqueda"
            action={{ label: 'Limpiar búsqueda', onClick: clearSearch }}
          />
        </motion.div>
      ) : (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {filteredRoutes.map((route) => (
            <motion.div key={route.id} variants={staggerItem}>
              <RouteCard
                route={route}
                onEdit={handleOpenEdit}
                onDeactivate={handleOpenDeactivate}
                onActivate={handleActivate}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Form Modal */}
      <RouteFormModal
        open={formOpen}
        mode={formMode}
        route={editingRoute}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
      />

      {/* Deactivate Confirmation */}
      <ConfirmModal
        open={deactivateTarget !== null}
        title="Desactivar ruta"
        message={`¿Estás seguro de desactivar la ruta "${deactivateTarget?.destination}"? Esta ruta dejará de aparecer en la selección de viajes nuevos.`}
        confirmLabel="Desactivar"
        cancelLabel="Cancelar"
        variant="danger"
        loading={deactivateLoading}
        onConfirm={handleConfirmDeactivate}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
