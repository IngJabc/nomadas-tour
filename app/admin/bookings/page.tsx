'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Users,
  ChevronRight,
  X,
  MapPin,
  UserCheck,
  AlertTriangle,
} from 'lucide-react';
import { adminApi } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

type Passenger = {
  rowId: string;
  passengerId: string | null;
  name: string;
  document: string;
  seatCode: string | null;
  boarded: boolean;
};

type ReservationGroup = {
  reservationId: string;
  status: string;
  qrCode: string;
  agency: { id: string; name: string } | null;
  passengers: Passenger[];
};

type TripGroup = {
  tripId: string;
  departureTime: string;
  status: string;
  capacity: number | null;
  stats: {
    reservations: number;
    passengers: number;
    boarded: number;
    cancelled: number;
  };
  reservations: ReservationGroup[];
};

type RouteGroup = {
  routeId: string;
  origin: string;
  destination: string;
  trips: TripGroup[];
};

interface RouteOption { id: string; origin: string; destination: string; }
interface AgencyOption { id: string; name: string; }

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'confirmed', label: 'Confirmadas' },
  { value: 'boarded', label: 'Abordados' },
  { value: 'cancelled', label: 'Canceladas' },
] as const;

const TRIP_STATUS: Record<string, { label: string; variant: 'active' | 'completed' | 'cancelled' | 'warning' }> = {
  active: { label: 'Activo', variant: 'active' },
  completed: { label: 'Completado', variant: 'completed' },
  cancelled: { label: 'Cancelado', variant: 'cancelled' },
};

const RESERVATION_STATUS: Record<string, { label: string; variant: 'confirmed' | 'cancelled' | 'boarded' | 'inactive' }> = {
  confirmed: { label: 'Confirmada', variant: 'confirmed' },
  cancelled: { label: 'Cancelada', variant: 'cancelled' },
  boarded: { label: 'Abordado', variant: 'boarded' },
  partial: { label: 'Confirmada', variant: 'confirmed' },
  completed: { label: 'Completada', variant: 'inactive' },
};

// ─── Animation Variants ───────────────────────────────────────────────────────

const pageFade = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

const staggerContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06 },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

const ease = [0.4, 0, 0.2, 1] as const;

const tripExpand = {
  hidden: { height: 0, opacity: 0 },
  visible: {
    height: 'auto',
    opacity: 1,
    transition: { height: { duration: 0.25, ease }, opacity: { duration: 0.2, delay: 0.05 } },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: { height: { duration: 0.2, ease }, opacity: { duration: 0.12 } },
  },
};

const passengerGrid = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.03 },
  },
};

const passengerCard = {
  hidden: { opacity: 0, scale: 0.96, y: 6 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.2, ease },
  },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.12 } },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Tooltip({ children, content }: { children: React.ReactNode; content: string }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const triggerRef = React.useRef<HTMLSpanElement>(null);

  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ x: rect.left + rect.width / 2, y: rect.top });
    }
  };

  return (
    <span
      ref={triggerRef}
      className="relative"
      onMouseEnter={() => { updatePosition(); setShow(true); }}
      onMouseLeave={() => setShow(false)}
      onFocus={() => { updatePosition(); setShow(true); }}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && createPortal(
        <span
          className="pointer-events-none fixed px-2 py-1 rounded-lg bg-[var(--color-brand-navy)] text-white text-[10px] font-[family-name:var(--font-body)] font-medium whitespace-nowrap shadow-lg"
          style={{ left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)', zIndex: 9999 }}
          role="tooltip"
        >
          {content}
        </span>,
        document.body,
      )}
    </span>
  );
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    short: format(d, 'dd/MM/yyyy HH:mm'),
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminBookingsPage() {
  const router = useRouter();

  const [tree, setTree] = useState<RouteGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [tripFilter, setTripFilter] = useState('');

  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [agencies, setAgencies] = useState<AgencyOption[]>([]);

  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());
  const [expandedTrips, setExpandedTrips] = useState<Set<string>>(new Set());

  // Derive trip options from tree based on selected route
  const tripOptions = useMemo(() => {
    const source = routeFilter
      ? tree.filter((r) => r.routeId === routeFilter)
      : tree;
    return source.flatMap((r) =>
      r.trips.map((t) => ({
        tripId: t.tripId,
        departureTime: t.departureTime,
        destination: r.destination,
      }))
    );
  }, [tree, routeFilter]);

  const doFetch = useCallback(async (raw: Record<string, string | undefined>) => {
    try {
      setFetchError(null);
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v) params[k] = v;
      }
      const data = await adminApi.getPassengerTree(params);
      setTree(data || []);
    } catch {
      setTree([]);
      setFetchError('No se pudieron cargar los pasajeros. Intenta de nuevo.');
    }
  }, []);

  // Build params from all filter states
  const buildParams = useCallback(() => {
    const p: Record<string, string> = {};
    if (statusFilter) p.status = statusFilter;
    if (searchFilter) p.search = searchFilter;
    if (routeFilter) p.route_id = routeFilter;
    if (agencyFilter) p.agency_id = agencyFilter;
    if (dateFilter) p.date = dateFilter;
    if (tripFilter) p.trip_id = tripFilter;
    return p;
  }, [statusFilter, searchFilter, routeFilter, agencyFilter, dateFilter, tripFilter]);

  const resetAccordion = () => {
    setExpandedRoutes(new Set());
    setExpandedTrips(new Set());
  };

  const refetch = useCallback(async () => {
    setLoading(true);
    await doFetch(buildParams());
    setLoading(false);
  }, [doFetch, buildParams]);

  // Initial fetch + load filter option lists
  useEffect(() => {
    Promise.all([
      doFetch({}),
      adminApi.listRoutes().then(setRoutes).catch(() => {}),
      adminApi.listAgencies().then(setAgencies).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [doFetch]);

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    resetAccordion();
    setLoading(true);
    doFetch({ status: value || undefined, search: searchFilter || undefined, route_id: routeFilter || undefined, agency_id: agencyFilter || undefined, date: dateFilter || undefined, trip_id: tripFilter || undefined }).finally(() => setLoading(false));
  };

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchWithSearch = useCallback((value: string) => {
    setSearchFilter(value);
    resetAccordion();
    setLoading(true);
    doFetch({ status: statusFilter || undefined, search: value || undefined, route_id: routeFilter || undefined, agency_id: agencyFilter || undefined, date: dateFilter || undefined, trip_id: tripFilter || undefined }).finally(() => setLoading(false));
  }, [doFetch, statusFilter, routeFilter, agencyFilter, dateFilter, tripFilter, resetAccordion]);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchWithSearch(value), 300);
  };

  const handleSearchImmediate = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    fetchWithSearch(searchInput);
  };

  const clearSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchInput('');
    fetchWithSearch('');
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const handleRouteChange = (value: string) => {
    setRouteFilter(value);
    setTripFilter('');
    resetAccordion();
    setLoading(true);
    doFetch({ status: statusFilter || undefined, search: searchFilter || undefined, route_id: value || undefined, agency_id: agencyFilter || undefined, date: dateFilter || undefined }).finally(() => setLoading(false));
  };

  const handleAgencyChange = (value: string) => {
    setAgencyFilter(value);
    resetAccordion();
    setLoading(true);
    doFetch({ status: statusFilter || undefined, search: searchFilter || undefined, route_id: routeFilter || undefined, agency_id: value || undefined, date: dateFilter || undefined, trip_id: tripFilter || undefined }).finally(() => setLoading(false));
  };

  const handleDateChange = (value: string) => {
    setDateFilter(value);
    resetAccordion();
    setLoading(true);
    doFetch({ status: statusFilter || undefined, search: searchFilter || undefined, route_id: routeFilter || undefined, agency_id: agencyFilter || undefined, date: value || undefined, trip_id: tripFilter || undefined }).finally(() => setLoading(false));
  };

  const clearDate = () => {
    setDateFilter('');
    resetAccordion();
    setLoading(true);
    doFetch({ status: statusFilter || undefined, search: searchFilter || undefined, route_id: routeFilter || undefined, agency_id: agencyFilter || undefined, trip_id: tripFilter || undefined }).finally(() => setLoading(false));
  };

  const handleTripChange = (value: string) => {
    setTripFilter(value);
    resetAccordion();
    setLoading(true);
    doFetch({ status: statusFilter || undefined, search: searchFilter || undefined, route_id: routeFilter || undefined, agency_id: agencyFilter || undefined, date: dateFilter || undefined, trip_id: value || undefined }).finally(() => setLoading(false));
  };

  const toggleRoute = (key: string) => {
    setExpandedRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleTrip = (id: string) => {
    setExpandedTrips((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const routeStats = (route: RouteGroup) => {
    return { trips: route.trips.length };
  };

  // ─── Loading ────────────────────────────────────────────────────────────

  if (loading && tree.length === 0) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title="Pasajeros" />
        <motion.div
          className="flex flex-col gap-3"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {[1, 2, 3].map((i) => (
            <motion.div key={i} variants={staggerItem}>
              <Card className="animate-pulse">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </main>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────────

  if (fetchError && tree.length === 0) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title="Pasajeros" />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="p-3 rounded-xl bg-[#fef2f2] border border-[#fee2e2] font-[family-name:var(--font-body)] text-sm text-[#ef4444]"
        >
          {fetchError}
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.2 }}
          className="mt-4"
        >
          <Button variant="secondary" onClick={() => doFetch(buildParams())}>
            Reintentar
          </Button>
        </motion.div>
      </main>
    );
  }

  // ─── Main render ────────────────────────────────────────────────────────

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25 }}
      >
        <PageHeader title="Pasajeros" />
      </motion.div>

      {/* Filters */}
      <motion.div
        className="flex flex-col gap-3 mb-6"
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        {/* Row 1: Status tabs */}
        <div className="flex justify-center min-w-0">
          <div className="flex items-center gap-1.5 bg-[var(--color-brand-surface)] rounded-xl h-9 px-1 border border-[rgba(0,0,0,0.06)] w-full sm:w-auto overflow-x-auto min-w-0">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleStatusChange(opt.value)}
                className={`shrink-0 sm:shrink px-3 py-1.5 rounded-lg text-xs sm:text-sm font-[family-name:var(--font-body)] font-medium transition-all duration-200 ${
                  statusFilter === opt.value
                    ? 'bg-[var(--color-brand-cyan)] text-white shadow-sm'
                    : 'text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] hover:bg-[rgba(0,0,0,0.03)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Search + filters in one row */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
          <div className="relative flex-1 min-w-0 basis-full sm:basis-[200px]">
            <input
              type="text"
              placeholder="Buscar pasajero, cédula, asiento, QR..."
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchImmediate()}
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

          <select
            value={agencyFilter}
            onChange={(e) => handleAgencyChange(e.target.value)}
            className={`w-full sm:w-44 sm:shrink-0 h-10 border-[1.5px] border-[#e5e7eb] rounded-xl px-3 text-xs sm:text-sm font-[family-name:var(--font-body)] font-normal bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] ${agencyFilter ? 'text-[var(--color-brand-navy)]' : 'text-[var(--color-brand-muted)]'}`}
          >
            <option value="">Agencias</option>
            {agencies.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <select
            value={routeFilter}
            onChange={(e) => handleRouteChange(e.target.value)}
            className={`w-full sm:w-44 sm:shrink-0 h-10 border-[1.5px] border-[#e5e7eb] rounded-xl px-3 text-xs sm:text-sm font-[family-name:var(--font-body)] font-normal bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] ${routeFilter ? 'text-[var(--color-brand-navy)]' : 'text-[var(--color-brand-muted)]'}`}
          >
            <option value="">Rutas</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>{r.destination}</option>
            ))}
          </select>

          {tripOptions.length > 0 && (
            <select
              value={tripFilter}
              onChange={(e) => handleTripChange(e.target.value)}
              className={`w-full sm:w-44 sm:shrink-0 h-10 border-[1.5px] border-[#e5e7eb] rounded-xl px-3 text-xs sm:text-sm font-[family-name:var(--font-body)] font-normal bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] ${tripFilter ? 'text-[var(--color-brand-navy)]' : 'text-[var(--color-brand-muted)]'}`}
            >
              <option value="">Viajes</option>
              {tripOptions.map((t) => {
                const dt = new Date(t.departureTime);
                const dateStr = dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
                const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                return (
                  <option key={t.tripId} value={t.tripId}>
                    {t.destination} — {dateStr} {timeStr}
                  </option>
                );
              })}
            </select>
          )}

          <AnimatePresence>
            {(statusFilter || searchFilter || routeFilter || agencyFilter || dateFilter || tripFilter) && (
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
                  setRouteFilter('');
                  setAgencyFilter('');
                  setDateFilter('');
                  setTripFilter('');
                  resetAccordion();
                  doFetch({});
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

      {/* Content */}
      {tree.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25 }}
        >
          <EmptyState
            icon={<Users className="w-8 h-8" />}
            message={
              searchFilter || statusFilter || routeFilter || agencyFilter || dateFilter || tripFilter
                ? 'No hay resultados con esos filtros'
                : 'Aún no hay pasajeros registrados'
            }
            action={
              searchFilter || statusFilter || routeFilter || agencyFilter || dateFilter || tripFilter
                ? { label: 'Limpiar filtros', onClick: () => { setSearchInput(''); setSearchFilter(''); setStatusFilter(''); setRouteFilter(''); setAgencyFilter(''); setDateFilter(''); setTripFilter(''); resetAccordion(); doFetch({}); } }
                : undefined
            }
          />
        </motion.div>
      ) : (
        <motion.div
          className="flex flex-col gap-3"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {tree.map((route) => {
            const rs = routeStats(route);
            const routeOpen = expandedRoutes.has(route.routeId);

            return (
              <motion.div key={route.routeId} variants={staggerItem}>
                <Card hover>
                  {/* Route header */}
                  <button
                    type="button"
                    onClick={() => toggleRoute(route.routeId)}
                    aria-expanded={routeOpen}
                    className="w-full flex items-center gap-3 text-left"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                      <MapPin className="w-5 h-5 text-[var(--color-brand-cyan)]" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]">
                          {route.destination}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)]">
                          {rs.trips} {rs.trips === 1 ? 'viaje' : 'viajes'}
                        </span>
                      </div>
                    </div>

                    <ChevronRight
                      className={`w-4 h-4 text-[var(--color-brand-muted)] shrink-0 transition-transform duration-200 ${routeOpen ? 'rotate-90' : ''}`}
                      strokeWidth={1.75}
                    />
                  </button>

                  {/* Trips */}
                  <AnimatePresence initial={false}>
                    {routeOpen && (
                      <motion.div
                        className="mt-4 space-y-3 overflow-hidden"
                        variants={tripExpand}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                      >
                        {route.trips.map((trip) => {
                          const tripOpen = expandedTrips.has(trip.tripId);
                          const ts = TRIP_STATUS[trip.status] ?? TRIP_STATUS.active;
                          const dt = formatDateTime(trip.departureTime);

                          return (
                            <div key={trip.tripId} className="rounded-xl border border-[rgba(0,0,0,0.06)] overflow-hidden">
                              {/* Trip header */}
                              <button
                                type="button"
                                onClick={() => toggleTrip(trip.tripId)}
                                aria-expanded={tripOpen}
                                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ${tripOpen ? 'bg-[var(--color-brand-surface)]' : 'bg-white hover:bg-[var(--color-brand-surface)]'}`}
                              >
                                <ChevronRight
                                  className={`w-3.5 h-3.5 text-[var(--color-brand-muted)] shrink-0 transition-transform duration-200 ${tripOpen ? 'rotate-90' : ''}`}
                                  strokeWidth={1.75}
                                />

                                <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                                  <span className="font-[family-name:var(--font-heading)] font-bold text-sm text-[var(--color-brand-navy)]">
                                    {dt.date}
                                  </span>
                                  <span className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                                    {dt.time}
                                  </span>
                                  <Badge variant={ts.variant} size="xs">{ts.label}</Badge>
                                </div>

                                <div className="flex items-center gap-3 shrink-0">
                                  <div className="hidden sm:flex items-center gap-2 text-[11px] font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
                                    <Tooltip content={trip.capacity != null ? `${trip.stats.passengers} pasajeros de ${trip.capacity} puestos totales` : `${trip.stats.passengers} pasajeros registrados`}>
                                      <span className="inline-flex items-center gap-1" role="img" aria-label={trip.capacity != null ? `${trip.stats.passengers} de ${trip.capacity} pasajeros` : `${trip.stats.passengers} pasajeros`} tabIndex={0}>
                                        <Users className="w-3 h-3" />
                                        {trip.capacity != null ? `${trip.stats.passengers} / ${trip.capacity}` : trip.stats.passengers}
                                      </span>
                                    </Tooltip>
                                    <Tooltip content={`${trip.stats.boarded} de ${trip.stats.passengers} pasajeros abordados`}>
                                      <span className="inline-flex items-center gap-1" role="img" aria-label={`${trip.stats.boarded} de ${trip.stats.passengers} pasajeros abordados`} tabIndex={0}>
                                        <UserCheck className="w-3 h-3 text-[#10b981]" />
                                        {trip.stats.boarded}
                                      </span>
                                    </Tooltip>
                                    {trip.stats.cancelled > 0 && (
                                      <Tooltip content={`${trip.stats.cancelled} pasajeros en reservas canceladas`}>
                                        <span className="inline-flex items-center gap-1" role="img" aria-label={`${trip.stats.cancelled} pasajeros en reservas canceladas`} tabIndex={0}>
                                          <AlertTriangle className="w-3 h-3 text-[#92400e]" />
                                          {trip.stats.cancelled}
                                        </span>
                                      </Tooltip>
                                    )}
                                  </div>
                                  <Badge variant="inactive" size="xs">
                                    {trip.stats.reservations} {trip.stats.reservations === 1 ? 'reserva' : 'reservas'}
                                  </Badge>
                                </div>
                              </button>

                              {/* Passenger grid */}
                              <AnimatePresence initial={false}>
                                {tripOpen && (
                                  <motion.div
                                    className="px-4 pb-4 pt-1 bg-[var(--color-brand-surface)] overflow-hidden"
                                    variants={tripExpand}
                                    initial="hidden"
                                    animate="visible"
                                    exit="exit"
                                  >
                                    <motion.div
                                      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2"
                                      variants={passengerGrid}
                                      initial="hidden"
                                      animate="visible"
                                    >
                                      {trip.reservations
                                        .flatMap((res) =>
                                          res.passengers.map((p) => ({ passenger: p, reservation: res }))
                                        )
                                        .sort((a, b) =>
                                          (a.passenger.seatCode || '\uffff').localeCompare(b.passenger.seatCode || '\uffff', undefined, { numeric: true })
                                        )
                                        .map(({ passenger: p, reservation: res }) => {
                                          const rs2 = RESERVATION_STATUS[res.status] ?? RESERVATION_STATUS.confirmed;
                                          return (
                                            <motion.button
                                              key={p.rowId}
                                              type="button"
                                              variants={passengerCard}
                                              onClick={() => router.push(`/admin/bookings/${res.reservationId}`)}
                                              className="flex items-center gap-3 p-3 bg-white rounded-xl border border-[rgba(0,0,0,0.06)] text-left cursor-pointer transition-all duration-150 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-[var(--color-brand-cyan)] focus-visible:outline-offset-2"
                                            >
                                              <div className="w-9 h-9 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                                                <span className="font-[family-name:var(--font-heading)] font-bold text-sm text-[var(--color-brand-cyan)]">
                                                  {p.seatCode ?? '—'}
                                                </span>
                                              </div>

                                              <div className="flex-1 min-w-0">
                                                <p className="font-[family-name:var(--font-body)] font-semibold text-[13px] text-[var(--color-brand-navy)] truncate">
                                                  {p.name}
                                                </p>
                                                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 mt-0.5">
                                                  <span className="font-[family-name:var(--font-body)] text-[10px] text-[var(--color-brand-muted)]">
                                                    {p.document || '—'}
                                                  </span>
                                                  {res.agency && (
                                                    <>
                                                      <span className="hidden sm:inline text-[var(--color-brand-muted)]">·</span>
                                                      <span className="font-[family-name:var(--font-body)] text-[10px] text-[var(--color-brand-muted)]">
                                                        {res.agency.name}
                                                      </span>
                                                    </>
                                                  )}
                                                </div>
                                              </div>

                                              <div className="flex flex-col items-end gap-1 shrink-0">
                                                {p.boarded ? (
                                                  <Badge variant="boarded" size="xs">Abordado</Badge>
                                                ) : (
                                                  <Badge variant={rs2.variant} size="xs">{rs2.label}</Badge>
                                                )}
                                              </div>
                                            </motion.button>
                                          );
                                        })}
                                    </motion.div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </main>
  );
}
