'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { MapPin, Search, X, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';

import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { RouteCard, RouteFormModal } from '@/components/admin/routes';
import type { RouteData } from '@/components/admin/routes';
import { adminApi } from '@/lib/api';
import { subscribeToRoutes, subscribeToTrips, subscribeToReservations } from '@/lib/realtime/subscriptions';
import { pageFade, staggerContainer, staggerItem } from '@/lib/motion/variants';

export default function AdminRoutesPage() {
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const routesRef = useRef<RouteData[]>([]);
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

  // Keep ref in sync so realtime callbacks see latest state
  useEffect(() => {
    routesRef.current = routes;
  });

  // Realtime: routes CRUD + trips/reservations counter recalculation
  useEffect(() => {
    const debounceTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    const handleRouteEvent = (payload: { eventType: string; route: Record<string, any> }) => {
      const { eventType, route } = payload;
      if (eventType === 'INSERT') {
        setRoutes((prev) => {
          if (prev.some((r) => r.id === route.id)) return prev;
          return [...prev, { id: route.id, origin: route.origin, destination: route.destination, status: route.status, tripCount: 0, reservationCount: 0 }];
        });
      } else if (eventType === 'UPDATE') {
        setRoutes((prev) =>
          prev.map((r) =>
            r.id === route.id
              ? { ...r, origin: route.origin ?? r.origin, destination: route.destination ?? r.destination, status: route.status ?? r.status }
              : r
          )
        );
      } else if (eventType === 'DELETE') {
        setRoutes((prev) => prev.filter((r) => r.id !== route.id));
      }
    };

    const handleTripOrReservation = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(async () => {
        if (!routesRef.current.length) return;
        try {
          const data = await adminApi.listRoutes();
          if (data) {
            setRoutes(data);
            routesRef.current = data;
          }
        } catch {
          // keep current state on error
        }
      }, 500);
    };

    const cleanupRoutes = subscribeToRoutes(handleRouteEvent);
    const cleanupTrips = subscribeToTrips(handleTripOrReservation);
    const cleanupReservations = subscribeToReservations(handleTripOrReservation);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      cleanupRoutes();
      cleanupTrips();
      cleanupReservations();
    };
  }, []);

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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerItem}>
            <div className="flex items-center justify-between mb-6">
              <div className="h-7 w-24 bg-slate-200 rounded-lg animate-pulse" />
              <div className="h-10 w-28 bg-slate-200 rounded-xl animate-pulse" />
            </div>
          </motion.div>
          <motion.div variants={staggerItem}>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 sm:max-w-96 h-10 bg-slate-200 rounded-xl animate-pulse" />
            </div>
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <motion.div key={i} variants={staggerItem}>
                <div className="bg-white rounded-2xl border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] animate-pulse shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="h-4 w-28 bg-slate-200 rounded-lg animate-pulse" />
                      <div className="h-3 w-36 bg-slate-100 rounded-lg animate-pulse" />
                      <div className="flex gap-2 mt-1.5">
                        <div className="h-5 w-12 bg-slate-200 rounded-full animate-pulse" />
                        <div className="h-5 w-16 bg-slate-100 rounded-full animate-pulse" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <div className="h-8 w-16 bg-slate-100 rounded-lg animate-pulse" />
                    <div className="h-8 w-22 bg-slate-100 rounded-lg animate-pulse" />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
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
        className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6"
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        <div className="relative flex-1 min-w-0 sm:max-w-96">
          <input
            type="text"
            placeholder="Buscar por destino u origen..."
            value={searchInput}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleEnter()}
            className="w-full h-10 border-[1.5px] border-[#e5e7eb] rounded-xl pl-8 pr-8 text-xs sm:text-sm font-[family-name:var(--font-body)] font-normal text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all duration-200"
          />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-brand-muted)]" />
          <AnimatePresence>
            {searchFilter && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] transition-colors duration-150"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {searchFilter && (
            <motion.button
              initial={{ opacity: 0, width: 0, scaleX: 0 }}
              animate={{ opacity: 1, width: 'auto', scaleX: 1 }}
              exit={{ opacity: 0, width: 0, scaleX: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              type="button"
              onClick={clearSearch}
              className="shrink-0 h-10 px-3 rounded-xl border border-[1.5px] border-[#e5e7eb] bg-white text-[var(--color-brand-muted)] hover:text-[#ef4444] hover:border-[#ef4444] transition-colors duration-150 flex items-center gap-1.5 text-xs font-[family-name:var(--font-body)] font-medium overflow-hidden origin-left"
            >
              <X className="w-3.5 h-3.5" />
              Limpiar
            </motion.button>
          )}
        </AnimatePresence>
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
      <AnimatePresence mode="wait">
        {routes.length === 0 ? (
          <motion.div
            key="empty-state"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
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
            key="search-empty"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
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
            key="routes-grid"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
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
      </AnimatePresence>

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
    </main>
  );
}
