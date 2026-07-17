'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bus, AlertTriangle, Search, X } from 'lucide-react';
import { agencyApi } from '@/lib/api';
import { subscribeToTripSeats, subscribeToTripAgencies, subscribeToTrips } from '@/lib/realtime/subscriptions';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { AgencyTripCardSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { AgencyTripCard, type AgencyTrip } from '@/components/agency/AgencyTripCard';
import { pageFade, staggerContainer, staggerItem } from '@/lib/motion/variants';

const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'active', label: 'Programados' },
  { value: 'completed', label: 'Completados' },
  { value: 'cancelled', label: 'Cancelados' },
] as const;

export default function AgencyTripsPage() {
  const [trips, setTrips] = useState<AgencyTrip[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tripIds, setTripIds] = useState<string[]>([]);
  const [agencyId, setAgencyId] = useState<string | null>(null);

  // Filters (client-side)
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setAgencyId((user?.user_metadata?.agency_id as string) ?? null);
    });
  }, []);

  const doFetch = useCallback(async () => {
    try {
      setFetchError(null);
      const data = await agencyApi.getTrips();
      setTrips(data);
      setTripIds(data.map((t: AgencyTrip) => t.id));
    } catch {
      setFetchError('No se pudieron cargar los viajes. Intenta de nuevo.');
    } finally {
      setInitialLoad(false);
    }
  }, []);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  // Client-side filtering
  const filteredTrips = useMemo(() => {
    let result = trips;

    if (statusFilter) {
      result = result.filter((t) => t.status === statusFilter);
    }

    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      result = result.filter((t) => {
        const dest = t.route?.destination?.toLowerCase() ?? '';
        const origin = t.route?.origin?.toLowerCase() ?? '';
        return dest.includes(q) || origin.includes(q);
      });
    }

    if (dateFilter) {
      result = result.filter((t) => {
        const tripDate = new Date(t.departure_time).toISOString().slice(0, 10);
        return tripDate === dateFilter;
      });
    }

    return result;
  }, [trips, statusFilter, searchFilter, dateFilter]);

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
  };

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchFilter(value), 300);
  };

  const handleSearchImmediate = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchFilter(searchInput);
  };

  const clearSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchInput('');
    setSearchFilter('');
  };

  const clearDate = () => {
    setDateFilter('');
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // Realtime: suscribirse a cambios de asientos con debounce y agrupación por trip_id
  useEffect(() => {
    if (!tripIds.length) return;

    const debounceTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    const pendingTripIds = new Set<string>();

    const flush = async () => {
      if (pendingTripIds.size === 0) return;
      const idsToFetch = Array.from(pendingTripIds);
      pendingTripIds.clear();

      for (const tripId of idsToFetch) {
        try {
          const fresh = await agencyApi.getTrip(tripId);
          const seats = fresh.seats ?? [];
          const available_seats = seats.filter((s: any) => s.status === 'available').length;
          const reserved_seats = seats.filter((s: any) => s.status === 'reserved' || s.status === 'boarded').length;

          setTrips((prev) => {
            const idx = prev.findIndex((t) => t.id === tripId);
            if (idx === -1) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], available_seats, reserved_seats };
            return updated;
          });
        } catch {
          // silently keep current state on realtime refetch error
        }
      }
    };

    const handleSeatUpdate = ({ seat }: { seat: any }) => {
      const tripId = seat.trip_id as string;
      if (!tripId) return;

      pendingTripIds.add(tripId);

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(flush, 500);
    };

    const cleanup = subscribeToTripSeats(tripIds, handleSeatUpdate);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      cleanup();
    };
  }, [tripIds]);

  // Realtime: refrescar lista cuando se asigna/desasigna un viaje a la agencia
  useEffect(() => {
    if (!agencyId) return;

    const debounceRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    const handleTripAgencyEvent = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(doFetch, 500);
    };

    const cleanup = subscribeToTripAgencies(handleTripAgencyEvent, agencyId);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      cleanup();
    };
  }, [agencyId, doFetch]);

  // Realtime: refrescar cuando cambian campos del viaje (status, departure_time, etc.)
  useEffect(() => {
    if (!tripIds.length) return;

    const tripIdsRef: { current: string[] } = { current: tripIds };
    tripIdsRef.current = tripIds;

    const debounceRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    const handleTripUpdate = (payload: { eventType: string; trip: Record<string, any> }) => {
      if (payload.eventType === 'DELETE') {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(doFetch, 500);
        return;
      }
      if (!tripIdsRef.current.includes(payload.trip.id)) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(doFetch, 500);
    };

    const cleanup = subscribeToTrips(handleTripUpdate, tripIds);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      cleanup();
    };
  }, [tripIds, doFetch]);

  const hasActiveFilters = statusFilter || searchFilter || dateFilter;

  // ─── Loading skeleton ─────────────────────────────────────────────────
  if (initialLoad) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="h-8 w-40 bg-slate-200 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => <AgencyTripCardSkeleton key={i} />)}
        </div>
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
        <PageHeader title="Mis viajes" />
      </motion.div>

      {fetchError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">{fetchError}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={doFetch}>
            Reintentar
          </Button>
        </motion.div>
      )}

      {/* Filters */}
      <motion.div
        className="flex flex-col gap-3 mb-6"
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        {/* Row 1: Status tabs */}
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

        {/* Row 2: Search, Date */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
          <div className="relative flex-1 min-w-0 basis-full sm:basis-[200px]">
            <input
              type="text"
              placeholder="Buscar destino u origen..."
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

          <div className="relative w-full sm:w-44 sm:shrink-0">
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
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
            {hasActiveFilters && (
              <motion.button
                initial={{ opacity: 0, width: 0, scaleX: 0 }}
                animate={{ opacity: 1, width: 'auto', scaleX: 1 }}
                exit={{ opacity: 0, width: 0, scaleX: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setSearchFilter('');
                  setStatusFilter('');
                  setDateFilter('');
                }}
                className="shrink-0 h-10 px-3 rounded-xl border border-[1.5px] border-[#e5e7eb] bg-white text-[var(--color-brand-muted)] hover:text-[#ef4444] hover:border-[#ef4444] transition-colors duration-150 flex items-center gap-1.5 text-xs font-[family-name:var(--font-body)] font-medium overflow-hidden origin-left"
              >
                <X className="w-3.5 h-3.5" />
                Limpiar
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {filteredTrips.length === 0 ? (
          <motion.div
            key="empty-state"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25 }}
          >
            <EmptyState
              icon={<Bus className="w-8 h-8" />}
              message={hasActiveFilters ? 'No hay viajes que coincidan con los filtros' : 'No tienes viajes asignados todavía'}
            />
          </motion.div>
        ) : (
          <motion.div
            key="trips-grid"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {filteredTrips.map((trip) => (
              <motion.div key={trip.id} variants={staggerItem}>
                <AgencyTripCard trip={trip} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
