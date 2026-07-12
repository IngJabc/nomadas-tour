'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { Search, Users, UserCheck, UserX, Route, ChevronRight, ArrowRight, Plus } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

type ReservationRow = {
  id: string;
  customer_name: string;
  passenger_cedula: string;
  seat_code: string;
  status: string;
  qr_code: string;
  transaction_id: string;
  trips: {
    id: string;
    departure_time: string;
    status: string;
    routes: { origin: string; destination: string } | null;
  } | null;
};

type RouteGroup = {
  routeKey: string;
  origin: string;
  destination: string;
  trips: TripGroup[];
};

type TripGroup = {
  tripId: string;
  departure_time: string;
  tripStatus: string;
  reservations: ReservationRow[];
};

function groupByRouteAndTrip(reservations: ReservationRow[]): RouteGroup[] {
  const routeMap = new Map<string, Map<string, ReservationRow[]>>();

  for (const r of reservations) {
    const route = r.trips?.routes;
    const origin = route?.origin ?? 'Desconocido';
    const destination = route?.destination ?? 'Desconocido';
    const routeKey = `${origin} → ${destination}`;
    const tripId = r.trips?.id ?? 'unknown';

    if (!routeMap.has(routeKey)) {
      routeMap.set(routeKey, new Map());
    }
    const tripMap = routeMap.get(routeKey)!;
    if (!tripMap.has(tripId)) {
      tripMap.set(tripId, []);
    }
    tripMap.get(tripId)!.push(r);
  }

  const groups: RouteGroup[] = [];
  for (const [routeKey, tripMap] of routeMap) {
    const first = tripMap.values().next().value?.[0];
    const origin = first?.trips?.routes?.origin ?? '';
    const destination = first?.trips?.routes?.destination ?? '';
    const trips: TripGroup[] = [];
    for (const [tripId, reservations] of tripMap) {
      const sample = reservations[0];
      trips.push({
        tripId,
        departure_time: sample.trips?.departure_time ?? '',
        tripStatus: sample.trips?.status ?? 'unknown',
        reservations,
      });
    }
    trips.sort((a, b) => new Date(b.departure_time).getTime() - new Date(a.departure_time).getTime());
    groups.push({ routeKey, origin, destination, trips });
  }

  groups.sort((a, b) => a.routeKey.localeCompare(b.routeKey));
  return groups;
}

const RESERVATION_STATUS: Record<string, { label: string; variant: 'confirmed' | 'cancelled' | 'boarded' }> = {
  confirmed: { label: 'Confirmada', variant: 'confirmed' },
  cancelled: { label: 'Cancelada', variant: 'cancelled' },
  boarded: { label: 'Abordado', variant: 'boarded' },
};

const TRIP_STATUS: Record<string, { label: string; variant: 'active' | 'completed' | 'cancelled' }> = {
  active: { label: 'Activo', variant: 'active' },
  completed: { label: 'Completado', variant: 'completed' },
  cancelled: { label: 'Cancelado', variant: 'cancelled' },
};

export default function AdminBookingsPage() {
  const router = useRouter();
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [filtered, setFiltered] = useState<ReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());
  const [expandedTrips, setExpandedTrips] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.listReservations();
      setReservations(data);
      setFiltered(data);
    } catch {
      setReservations([]);
      setFiltered([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    let result = reservations;
    if (statusFilter) {
      result = result.filter((r) => r.status === statusFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.customer_name.toLowerCase().includes(q) ||
          r.passenger_cedula?.toLowerCase().includes(q) ||
          r.seat_code?.toLowerCase().includes(q) ||
          r.qr_code?.toLowerCase().includes(q),
      );
    }
    setFiltered(result);
  }, [search, statusFilter, reservations]);

  const groups = groupByRouteAndTrip(filtered);
  const totalPassengers = filtered.length;
  const confirmedCount = filtered.filter((r) => r.status === 'confirmed').length;
  const boardedCount = filtered.filter((r) => r.status === 'boarded').length;
  const cancelledCount = filtered.filter((r) => r.status === 'cancelled').length;

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

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <PageHeader
        title="Pasajeros y reservas"
        action={
          <Link href="/admin/trips" className="no-underline">
            <Button>
              <Plus className="w-4 h-4" />
              Nuevo viaje
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Pasajeros"
          value={totalPassengers}
          loading={loading}
        />
        <StatCard
          icon={<UserCheck className="w-5 h-5" />}
          label="Confirmadas"
          value={confirmedCount}
          loading={loading}
          iconBg="bg-[rgba(16,185,129,0.1)]"
          iconColor="text-[#10b981]"
        />
        <StatCard
          icon={<UserX className="w-5 h-5" />}
          label="Canceladas"
          value={cancelledCount}
          loading={loading}
          iconBg="bg-[rgba(239,68,68,0.1)]"
          iconColor="text-[#ef4444]"
        />
        <StatCard
          icon={<Route className="w-5 h-5" />}
          label="Rutas activas"
          value={groups.length}
          loading={loading}
          iconBg="bg-[rgba(245,158,11,0.1)]"
          iconColor="text-[#f59e0b]"
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex-1">
          <Input
            label="Buscar"
            leftIcon={<Search className="w-4 h-4" />}
            type="text"
            placeholder="Pasajero, cédula, asiento, QR..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[['', 'Todas'], ['confirmed', 'Confirmadas'], ['boarded', 'Abordados'], ['cancelled', 'Canceladas']].map(([s, label]) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-4 py-2.5 rounded-xl font-[family-name:var(--font-body)] font-semibold text-[13px] whitespace-nowrap cursor-pointer transition-all ${
                  active
                    ? 'border-[1.5px] border-[var(--color-brand-cyan)] bg-[rgba(0,212,255,0.08)] text-[var(--color-brand-cyan)]'
                    : 'border-[1.5px] border-[#e5e7eb] bg-[var(--color-brand-surface)] text-[var(--color-brand-muted)]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-[var(--color-brand-surface)] rounded-2xl p-6 animate-pulse border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
              <div className="h-5 w-48 bg-slate-200 rounded mb-3" />
              <div className="h-4 w-32 bg-[var(--color-page-bg)] rounded mb-2" />
              <div className="h-4 w-64 bg-[var(--color-page-bg)] rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="w-8 h-8" />}
          message={
            search || statusFilter
              ? 'No hay resultados con esos filtros'
              : 'Aún no hay reservas registradas'
          }
          action={
            search || statusFilter
              ? { label: 'Limpiar filtros', onClick: () => { setSearch(''); setStatusFilter(''); } }
              : { label: 'Ver viajes disponibles', href: '/admin/trips' }
          }
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {groups.map((route) => {
            const routeOpen = expandedRoutes.has(route.routeKey);
            const totalTrips = route.trips.length;
            const routePassengers = route.trips.reduce((sum, t) => sum + t.reservations.length, 0);

            return (
              <div key={route.routeKey} className="bg-[var(--color-brand-surface)] rounded-2xl overflow-hidden border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
                <button
                  type="button"
                  onClick={() => toggleRoute(route.routeKey)}
                  className="w-full flex items-center gap-3 px-4 sm:px-5 py-4 bg-none border-none cursor-pointer text-left border-l-4 border-l-[var(--color-brand-cyan)]"
                >
                  <ChevronRight className={`w-4 h-4 text-[var(--color-brand-muted)] shrink-0 transition-transform duration-200 ${routeOpen ? 'rotate-90' : ''}`} strokeWidth={1.75} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]">{route.origin}</span>
                      <ArrowRight className="w-5 h-5 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
                      <span className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]">{route.destination}</span>
                    </div>
                  </div>
                  <div className="flex gap-3 items-center shrink-0">
                    <div className="text-right">
                      <span className="font-[family-name:var(--font-body)] font-semibold text-[13px] text-[var(--color-brand-cyan)]">{routePassengers}</span>
                      <span className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] ml-1">pasajeros</span>
                    </div>
                    <Badge variant="inactive" size="sm">{totalTrips} {totalTrips === 1 ? 'viaje' : 'viajes'}</Badge>
                  </div>
                </button>

                {routeOpen && (
                  <div className="border-t border-[rgba(0,0,0,0.06)]">
                    {route.trips.map((trip) => {
                      const tripOpen = expandedTrips.has(trip.tripId);
                      const ts = TRIP_STATUS[trip.tripStatus] ?? TRIP_STATUS.active;

                      return (
                        <div key={trip.tripId}>
                          <button
                            type="button"
                            onClick={() => toggleTrip(trip.tripId)}
                            className={`w-full flex items-center gap-2.5 px-5 py-3.5 pl-9 border-none cursor-pointer text-left border-b border-[rgba(0,0,0,0.04)] transition-colors duration-150 ${tripOpen ? 'bg-[#f8fafc]' : 'bg-transparent'}`}
                          >
                            <ChevronRight className={`w-3.5 h-3.5 text-[var(--color-brand-muted)] shrink-0 transition-transform duration-200 ${tripOpen ? 'rotate-90' : ''}`} strokeWidth={1.75} />
                            <span className="font-[family-name:var(--font-body)] font-semibold text-[13px] text-[var(--color-brand-navy)]">
                              {format(new Date(trip.departure_time), 'dd/MM/yyyy HH:mm')}
                            </span>
                            <Badge variant={ts.variant} size="xs">{ts.label}</Badge>
                          </button>

                          <div className={`grid transition-all duration-300 ease-in-out ${tripOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                            <div className="overflow-hidden">
                              <div className="px-4 sm:px-5 pb-3 sm:pl-12">
                                {trip.reservations.map((r) => {
                                  const bs = RESERVATION_STATUS[r.status] ?? RESERVATION_STATUS.confirmed;
                                  return (
                                    <div
                                      key={r.id}
                                      onClick={() => router.push(`/admin/bookings/${r.id}`)}
                                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') router.push(`/admin/bookings/${r.id}`); }}
                                      role="button"
                                      tabIndex={0}
                                      className="flex items-center gap-2 py-2.5 border-b border-[rgba(0,0,0,0.04)] hover:bg-[#f8fafc] transition-colors cursor-pointer rounded-lg px-2 -mx-2 focus-visible:outline-2 focus-visible:outline-[var(--color-brand-cyan)] focus-visible:outline-offset-2"
                                    >
                                      <span className="flex-1 font-[family-name:var(--font-body)] font-medium text-[13px] text-[var(--color-brand-navy)] truncate">{r.customer_name}</span>
                                      <span className="w-24 font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">{r.passenger_cedula ?? '—'}</span>
                                      <span className="w-16 font-[family-name:var(--font-body)] font-bold text-[13px] text-[var(--color-brand-navy)] bg-slate-100 px-2.5 py-0.5 rounded-md text-center">{r.seat_code ?? '—'}</span>
                                      <Badge variant={bs.variant} size="xs">{bs.label}</Badge>
                                      <span className="w-16 font-[family-name:var(--font-body)] font-normal text-[10px] text-[var(--color-brand-muted)] tabular-nums">{r.qr_code?.split('-').pop() ?? '—'}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
