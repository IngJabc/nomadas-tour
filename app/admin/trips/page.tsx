'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Calendar, Search, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { TripCard } from '@/components/admin/trips/TripCard';
import { TripBuilderModal } from '@/components/admin/trip-builder/TripBuilderModal';
import { subscribeToTripSeats } from '@/lib/realtime/subscriptions';
import { adminApi } from '@/lib/api';
import type { Route } from '@/types';
interface AgencyOption { id: string; name: string; }

const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'active', label: 'Activo' },
  { value: 'completed', label: 'Completado' },
  { value: 'cancelled', label: 'Cancelado' },
] as const;

function canComplete(departureTime: string) {
  return new Date() >= new Date(departureTime);
}

function canCancelOrPostpone(departureTime: string) {
  return new Date() < new Date(departureTime);
}

function syncUrl(page: number, status: string, routeId: string, agencyId: string, search: string, date: string) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  if (status) params.set('status', status);
  if (routeId) params.set('route_id', routeId);
  if (agencyId) params.set('agency_id', agencyId);
  if (search) params.set('search', search);
  if (date) params.set('departure_date', date);
  window.history.replaceState(null, '', `/admin/trips?${params.toString()}`);
}

export default function AdminTripsPage() {
  const searchParams = useSearchParams();

  const [trips, setTrips] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 6, total: 0, totalPages: 1 });
  const [initialLoad, setInitialLoad] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderMode, setBuilderMode] = useState<'create' | 'edit'>('create');
  const [editingTripId, setEditingTripId] = useState<string | undefined>(undefined);

  // Filters
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '');
  const [routeFilter, setRouteFilter] = useState(searchParams.get('route_id') || '');
  const [searchFilter, setSearchFilter] = useState(searchParams.get('search') || '');
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [filterLoading, setFilterLoading] = useState(false);
  const [routes, setRoutes] = useState<Route[]>([]);

  const [agencyFilter, setAgencyFilter] = useState(searchParams.get('agency_id') || '');
  const [agencies, setAgencies] = useState<AgencyOption[]>([]);
  const [dateFilter, setDateFilter] = useState(searchParams.get('departure_date') || '');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const page = parseInt(searchParams.get('page') || '1');

  useEffect(() => {
    Promise.all([
      adminApi.listRoutes().then(setRoutes).catch(() => {}),
      adminApi.listAgencies().then(setAgencies).catch(() => {}),
    ]);
  }, []);

  const buildParams = useCallback((p: number, status: string, routeId: string, agencyId: string, search: string, date: string) => {
    const params: Record<string, string> = { page: String(p), limit: '6' };
    if (status) params.status = status;
    if (routeId) params.route_id = routeId;
    if (agencyId) params.agency_id = agencyId;
    if (search) params.search = search;
    if (date) params.departure_date = date;
    return params;
  }, []);

  const doFetch = useCallback(async (p: number, status: string, routeId: string, agencyId: string, search: string, date: string) => {
    try {
      setFetchError(null);
      const params = buildParams(p, status, routeId, agencyId, search, date);
      const data = await adminApi.listTrips(params);
      setTrips(data.data || []);
      setPagination(data.pagination || { page: p, limit: 6, total: 0, totalPages: 1 });
    } catch {
      setTrips([]);
      setFetchError('No se pudieron cargar los viajes. Intenta de nuevo.');
    }
  }, [buildParams]);

  // Initial fetch only
  useEffect(() => {
    doFetch(page, statusFilter, routeFilter, agencyFilter, searchFilter, dateFilter).finally(() => setInitialLoad(false));
  }, []);

  // Stable key from visible trip IDs — solo cambia cuando cambian los IDs
  const tripIdsKey = useMemo(
    () => (trips.length > 0 ? trips.map((t) => t.id).sort().join(',') : ''),
    [trips],
  );

  const handleSeatUpdate = useCallback((seat: any) => {
    setTrips((prev) =>
      prev.map((t) => {
        if (t.id !== seat.trip_id) return t;
        const occ = { ...t.occupancy };
        if (seat.status === 'available') {
          occ.available = (occ.available || 0) + 1;
          occ.reserved = (occ.reserved || 0) - 1;
        } else {
          occ.available = (occ.available || 0) - 1;
          occ.reserved = (occ.reserved || 0) + 1;
        }
        return { ...t, occupancy: occ };
      }),
    );
  }, []);

  // Realtime: subscribe to visible trips
  useEffect(() => {
    if (!tripIdsKey) return;
    const tripIds = tripIdsKey.split(',');
    const cleanup = subscribeToTripSeats(tripIds, handleSeatUpdate);
    return cleanup;
  }, [tripIdsKey, handleSeatUpdate]);

  const handleEdit = useCallback(async (tripId: string) => {
    setEditingTripId(tripId);
    setBuilderMode('edit');
    setBuilderOpen(true);
  }, []);

  const handleBuilderClose = useCallback(() => {
    setBuilderOpen(false);
    setEditingTripId(undefined);
  }, []);

  const handleBuilderSuccess = useCallback(() => {
    setBuilderOpen(false);
    setEditingTripId(undefined);
    doFetch(page, statusFilter, routeFilter, agencyFilter, searchFilter, dateFilter);
  }, [doFetch, page, statusFilter, routeFilter, agencyFilter, searchFilter, dateFilter]);

  const handleDelete = async (tripId: string) => {
    setActionLoading(tripId);
    try {
      await adminApi.deleteTrip(tripId);
      setTrips((prev) => prev.filter((t: any) => t.id !== tripId));
    } catch {
      toast.error('No se pudo eliminar el viaje');
    } finally {
      setActionLoading(null);
    }
  };

  const handleComplete = async (tripId: string) => {
    setActionLoading(tripId);
    try {
      await adminApi.updateTripStatus(tripId, 'completed');
      setTrips((prev) => prev.map((t: any) => t.id === tripId ? { ...t, status: 'completed' } : t));
    } catch {
      toast.error('No se pudo completar el viaje');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (tripId: string) => {
    setActionLoading(tripId);
    try {
      await adminApi.updateTripStatus(tripId, 'cancelled');
      setTrips((prev) => prev.map((t: any) => t.id === tripId ? { ...t, status: 'cancelled' } : t));
    } catch {
      toast.error('No se pudo cancelar el viaje');
    } finally {
      setActionLoading(null);
    }
  };

  const handlePostponeInline = async (trip: any, newDate: string) => {
    setActionLoading(trip.id);
    try {
      const data = {
        route_id: trip.route_id,
        departure_time: newDate,
        vehicle_type: trip.vehicle_type ?? 'bus',
        agency_ids: (trip.trip_agencies || []).map((a: any) => a.agency_id),
      };
      await adminApi.updateTrip(trip.id, data);
      doFetch(page, statusFilter, routeFilter, agencyFilter, searchFilter, dateFilter);
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  };

  const updateFilter = (newStatus: string, newRoute: string, newAgency: string, newSearch: string, newDate: string) => {
    setStatusFilter(newStatus);
    setRouteFilter(newRoute);
    setAgencyFilter(newAgency);
    setSearchFilter(newSearch);
    setDateFilter(newDate);
    setFilterLoading(true);
    doFetch(1, newStatus, newRoute, newAgency, newSearch, newDate).finally(() => setFilterLoading(false));
    syncUrl(1, newStatus, newRoute, newAgency, newSearch, newDate);
  };

  const handleStatusChange = (value: string) => {
    updateFilter(value, routeFilter, agencyFilter, searchFilter, dateFilter);
  };

  const handleRouteChange = (value: string) => {
    updateFilter(statusFilter, value, agencyFilter, searchFilter, dateFilter);
  };

  const handleAgencyChange = (value: string) => {
    updateFilter(statusFilter, routeFilter, value, searchFilter, dateFilter);
  };

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateFilter(statusFilter, routeFilter, agencyFilter, value, dateFilter);
    }, 300);
  };

  const handleSearchImmediate = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    updateFilter(statusFilter, routeFilter, agencyFilter, searchInput, dateFilter);
  };

  const clearSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchInput('');
    updateFilter(statusFilter, routeFilter, agencyFilter, '', dateFilter);
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const handleDateChange = (value: string) => {
    updateFilter(statusFilter, routeFilter, agencyFilter, searchFilter, value);
  };

  const clearDate = () => {
    updateFilter(statusFilter, routeFilter, agencyFilter, searchFilter, '');
  };

  const handlePageChange = (newPage: number) => {
    setFilterLoading(true);
    doFetch(newPage, statusFilter, routeFilter, agencyFilter, searchFilter, dateFilter).finally(() => setFilterLoading(false));
    syncUrl(newPage, statusFilter, routeFilter, agencyFilter, searchFilter, dateFilter);
  };

  const isActive = (t: any) => t.status === 'active';

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
        <PageHeader
        title="Viajes"
        action={
          <Button onClick={() => { setBuilderMode('create'); setBuilderOpen(true); }}>
            <Plus className="w-4 h-4" />
            Nuevo viaje
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-6">
        {/* Row 1: Status centered */}
        <div className="flex justify-center">
          <div className="flex items-center gap-1.5 bg-[var(--color-brand-surface)] rounded-xl h-9 px-1 border border-[rgba(0,0,0,0.06)] w-full sm:w-auto">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleStatusChange(opt.value)}
                className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-xs sm:text-sm font-[family-name:var(--font-body)] font-medium transition-colors ${
                   statusFilter === opt.value
                     ? 'bg-[var(--color-brand-cyan)] text-white'
                     : 'text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)]'
                 }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Search, Route, Agency, Date */}
        <motion.div layout className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
          <div className="relative flex-1 min-w-0 basis-full sm:basis-[200px]">
            <input
              type="text"
              placeholder="Buscar destino o agencia..."
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchImmediate()}
              className="w-full h-10 border-[1.5px] border-[#e5e7eb] rounded-xl pl-8 pr-8 text-xs sm:text-sm font-[family-name:var(--font-body)] font-normal text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]"
            />
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-brand-muted)]" />
            {searchFilter && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            value={routeFilter}
            onChange={(e) => handleRouteChange(e.target.value)}
            className={`w-full sm:w-44 sm:shrink-0 h-10 border-[1.5px] border-[#e5e7eb] rounded-xl px-3 text-xs sm:text-sm font-[family-name:var(--font-body)] font-normal bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] ${routeFilter ? 'text-[var(--color-brand-navy)]' : 'text-[var(--color-brand-muted)]'}`}
          >
            <option value="">Ruta</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.destination}
              </option>
            ))}
          </select>

          <select
            value={agencyFilter}
            onChange={(e) => handleAgencyChange(e.target.value)}
            className={`w-full sm:w-44 sm:shrink-0 h-10 border-[1.5px] border-[#e5e7eb] rounded-xl px-3 text-xs sm:text-sm font-[family-name:var(--font-body)] font-normal bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] ${agencyFilter ? 'text-[var(--color-brand-navy)]' : 'text-[var(--color-brand-muted)]'}`}
          >
            <option value="">Agencia</option>
            {agencies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <div className="relative w-full sm:w-44 sm:shrink-0">
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full h-10 border-[1.5px] border-[#e5e7eb] rounded-xl px-3 pr-8 text-xs sm:text-sm font-[family-name:var(--font-body)] font-normal text-[var(--color-brand-muted)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] [&::-webkit-calendar-picker-indicator]:opacity-40 [&::-webkit-calendar-picker-indicator]:hover:opacity-70"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={clearDate}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <AnimatePresence>
            {(statusFilter || searchFilter || routeFilter || agencyFilter || dateFilter) && (
              <motion.button
                layout
                initial={{ opacity: 0, width: 0, scaleX: 0 }}
                animate={{ opacity: 1, width: 'auto', scaleX: 1 }}
                exit={{ opacity: 0, width: 0, scaleX: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setSearchFilter('');
                  setStatusFilter('');
                  setRouteFilter('');
                  setAgencyFilter('');
                  setDateFilter('');
                  doFetch(1, '', '', '', '', '');
                }}
                className="shrink-0 h-10 px-3 rounded-xl border border-[1.5px] border-[#e5e7eb] bg-white text-[var(--color-brand-muted)] hover:text-[#ef4444] hover:border-[#ef4444] transition-colors duration-150 flex items-center gap-1.5 text-xs font-[family-name:var(--font-body)] font-medium overflow-hidden origin-left"
              >
                <X className="w-3.5 h-3.5" />
                Limpiar
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Pagination top-right (like Gmail) */}
      {trips.length > 0 && pagination.totalPages > 1 && (
        <div className="flex items-center justify-end gap-1 mb-4">
          <button
            type="button"
            aria-label="Página anterior"
            onClick={() => handlePageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-transparent border-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed text-[var(--color-brand-muted)] hover:bg-slate-100 hover:text-[var(--color-brand-navy)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
          </button>
          <span className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] tabular-nums min-w-[52px] text-center select-none">
            {(pagination.page - 1) * pagination.limit + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} de {pagination.total}
          </span>
          <button
            type="button"
            aria-label="Página siguiente"
            onClick={() => handlePageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-transparent border-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed text-[var(--color-brand-muted)] hover:bg-slate-100 hover:text-[var(--color-brand-navy)] transition-colors"
          >
            <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {fetchError && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]">
          <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">{fetchError}</p>
          <Button variant="secondary" size="sm" onClick={() => doFetch(page, statusFilter, routeFilter, agencyFilter, searchFilter, dateFilter)}>
            Reintentar
          </Button>
        </div>
      )}

      {filterLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {[1, 2, 3, 4, 5, 6].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : trips.length === 0 ? (
        <EmptyState
          icon={<Calendar className="w-8 h-8" />}
          message="No hay viajes registrados"
          action={{
            label: 'Crear nuevo viaje',
            onClick: () => { setBuilderMode('create'); setBuilderOpen(true); },
          }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {trips.map((trip) => (
            <motion.div
              key={trip.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <TripCard
                trip={trip}
                onEdit={handleEdit}
                onComplete={handleComplete}
                onCancel={handleCancel}
                onPostpone={handlePostponeInline}
                onDelete={handleDelete}
                actionLoading={actionLoading}
                canComplete={isActive(trip) && canComplete(trip.departure_time)}
                canCancelPostpone={isActive(trip) && canCancelOrPostpone(trip.departure_time)}
              />
            </motion.div>
          ))}
        </div>
      )}

      <TripBuilderModal
        open={builderOpen}
        mode={builderMode}
        tripId={builderMode === 'edit' ? editingTripId : undefined}
        onClose={handleBuilderClose}
        onSuccess={handleBuilderSuccess}
      />
    </div>
  );
}
