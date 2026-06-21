'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

type BookingRow = {
  id: string;
  user_id: string;
  trip_id: string;
  seat_id: string;
  passenger_name: string;
  passenger_email: string;
  passenger_cedula: string;
  qr_code: string;
  status: string;
  created_at: string;
  seat: { seat_code: string } | null;
  trip: {
    id: string;
    departure_at: string;
    price: number;
    total_seats: number;
    status: string;
    route: { origin: string; destination: string; duration_minutes: number } | null;
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
  departure_at: string;
  tripStatus: string;
  totalSeats: number;
  price: number;
  bookings: BookingRow[];
};

function groupByRouteAndTrip(bookings: BookingRow[]): RouteGroup[] {
  const routeMap = new Map<string, Map<string, BookingRow[]>>();

  for (const b of bookings) {
    const route = b.trip?.route;
    const origin = route?.origin ?? 'Desconocido';
    const destination = route?.destination ?? 'Desconocido';
    const routeKey = `${origin} → ${destination}`;
    const tripId = b.trip?.id ?? 'unknown';

    if (!routeMap.has(routeKey)) {
      routeMap.set(routeKey, new Map());
    }
    const tripMap = routeMap.get(routeKey)!;
    if (!tripMap.has(tripId)) {
      tripMap.set(tripId, []);
    }
    tripMap.get(tripId)!.push(b);
  }

  const groups: RouteGroup[] = [];
  for (const [routeKey, tripMap] of routeMap) {
    const first = tripMap.values().next().value?.[0];
    const origin = first?.trip?.route?.origin ?? '';
    const destination = first?.trip?.route?.destination ?? '';
    const trips: TripGroup[] = [];
    for (const [tripId, bookings] of tripMap) {
      const sample = bookings[0];
      trips.push({
        tripId,
        departure_at: sample.trip?.departure_at ?? '',
        tripStatus: sample.trip?.status ?? 'unknown',
        totalSeats: sample.trip?.total_seats ?? 0,
        price: sample.trip?.price ?? 0,
        bookings,
      });
    }
    trips.sort((a, b) => new Date(b.departure_at).getTime() - new Date(a.departure_at).getTime());
    groups.push({ routeKey, origin, destination, trips });
  }

  groups.sort((a, b) => a.routeKey.localeCompare(b.routeKey));
  return groups;
}

const STATUS_STYLES: Record<string, { label: string; pill: string }> = {
  confirmed: { label: 'Confirmada', pill: 'bg-emerald-50 text-emerald-600' },
  cancelled: { label: 'Cancelada', pill: 'bg-red-50 text-red-500' },
};

const TRIP_STATUS_STYLES: Record<string, { label: string; pill: string }> = {
  active: { label: 'Activo', pill: 'bg-emerald-50 text-emerald-600' },
  completed: { label: 'Completado', pill: 'bg-slate-100 text-brand-muted' },
  cancelled: { label: 'Cancelado', pill: 'bg-red-50 text-red-500' },
};

export default function AdminBookingsPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [filtered, setFiltered] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());
  const [expandedTrips, setExpandedTrips] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/admin/bookings?${params.toString()}`);
      const data = await res.json();
      setBookings(data);
      setFiltered(data);
    } catch {
      setBookings([]);
      setFiltered([]);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const groups = groupByRouteAndTrip(filtered);
  const totalPassengers = filtered.length;
  const confirmedCount = filtered.filter((b) => b.status === 'confirmed').length;

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

  const handleSearch = (val: string) => {
    setSearch(val);
  };

  return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <p className="font-['Poppins',sans-serif] font-normal text-xs text-brand-muted">
              <Link href="/admin" className="text-brand-cyan no-underline hover:underline">Admin</Link>
              {' / Pasajeros'}
            </p>
            <h1 className="font-['Montserrat',sans-serif] font-extrabold text-[22px] sm:text-2xl text-brand-navy">
              Pasajeros y reservas
            </h1>
          </div>
          <Link
            href="/admin/trips"
            className="self-start sm:self-auto inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-sm whitespace-nowrap no-underline hover:bg-brand-blue transition-colors duration-200"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Nuevo viaje
          </Link>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.07)] border-l-4 border-l-brand-cyan">
            <p className="font-['Poppins',sans-serif] font-semibold text-[11px] text-brand-muted uppercase tracking-wider">
              Pasajeros
            </p>
            <p className="font-['Montserrat',sans-serif] font-extrabold text-[28px] text-brand-navy mt-1">
              {totalPassengers}
            </p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.07)] border-l-4 border-l-emerald-500">
            <p className="font-['Poppins',sans-serif] font-semibold text-[11px] text-brand-muted uppercase tracking-wider">
              Confirmadas
            </p>
            <p className="font-['Montserrat',sans-serif] font-extrabold text-[28px] text-emerald-500 mt-1">
              {confirmedCount}
            </p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.07)] border-l-4 border-l-red-500">
            <p className="font-['Poppins',sans-serif] font-semibold text-[11px] text-brand-muted uppercase tracking-wider">
              Canceladas
            </p>
            <p className="font-['Montserrat',sans-serif] font-extrabold text-[28px] text-red-500 mt-1">
              {totalPassengers - confirmedCount}
            </p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.07)] border-l-4 border-l-amber-500">
            <p className="font-['Poppins',sans-serif] font-semibold text-[11px] text-brand-muted uppercase tracking-wider">
              Rutas activas
            </p>
            <p className="font-['Montserrat',sans-serif] font-extrabold text-[28px] text-amber-500 mt-1">
              {groups.length}
            </p>
          </div>
        </div>

        {/* Search + Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none"
            >
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
              <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Buscar pasajero, cédula, ruta, asiento, código QR..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full py-3 pl-10 pr-4 border-[1.5px] border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm font-normal text-brand-navy bg-white outline-none focus:border-brand-cyan focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all box-border"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {['', 'confirmed', 'cancelled'].map((s) => {
              const label = s === '' ? 'Todas' : s === 'confirmed' ? 'Confirmadas' : 'Canceladas';
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`px-4 py-2.5 rounded-xl font-['Poppins',sans-serif] font-semibold text-[13px] whitespace-nowrap cursor-pointer transition-all ${
                    active
                      ? 'border-[1.5px] border-brand-cyan bg-[rgba(0,212,255,0.08)] text-brand-cyan'
                      : 'border-[1.5px] border-gray-200 bg-white text-brand-muted'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl p-6 animate-pulse shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
                <div className="h-5 w-48 bg-slate-200 rounded mb-3" />
                <div className="h-4 w-32 bg-slate-100 rounded mb-2" />
                <div className="h-4 w-64 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-brand-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">
              {search || statusFilter ? 'No hay resultados con esos filtros' : 'Aún no hay reservas registradas'}
            </p>
            {search || statusFilter ? (
              <button
                type="button"
                onClick={() => { setSearch(''); setStatusFilter(''); }}
                className="mt-3 px-4 py-2 rounded-lg font-['Poppins',sans-serif] font-semibold text-[13px] bg-slate-100 text-brand-navy border-none cursor-pointer"
              >
                Limpiar filtros
              </button>
            ) : (
              <Link
                href="/admin/trips"
                className="mt-4 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-sm no-underline hover:bg-brand-blue transition-colors"
              >
                Ver viajes disponibles
              </Link>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {groups.map((route) => {
              const routeOpen = expandedRoutes.has(route.routeKey);
              const totalTrips = route.trips.length;
              const routePassengers = route.trips.reduce((sum, t) => sum + t.bookings.length, 0);

              return (
                <div key={route.routeKey} className="bg-white rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
                  {/* Route header */}
                  <button
                    type="button"
                    onClick={() => toggleRoute(route.routeKey)}
                    className="w-full flex items-center gap-3 px-4 sm:px-5 py-4 bg-none border-none cursor-pointer text-left border-l-4 border-l-brand-cyan"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      className={`shrink-0 transition-transform duration-200 ${routeOpen ? 'rotate-90' : ''}`}
                    >
                      <path d="M6 4l4 4-4 4" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-['Montserrat',sans-serif] font-bold text-base text-brand-navy">
                          {route.origin}
                        </span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <path d="M5 12h14M13 5l7 7-7 7" stroke="#00D4FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="font-['Montserrat',sans-serif] font-bold text-base text-brand-navy">
                          {route.destination}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-3 items-center shrink-0">
                      <div className="text-right">
                        <span className="font-['Poppins',sans-serif] font-semibold text-[13px] text-brand-cyan">
                          {routePassengers}
                        </span>
                        <span className="font-['Poppins',sans-serif] font-normal text-[11px] text-brand-muted ml-1">
                          pasajeros
                        </span>
                      </div>
                      <span className="inline-block bg-slate-100 text-brand-muted font-['Poppins',sans-serif] font-semibold text-[11px] px-2.5 py-0.5 rounded-full">
                        {totalTrips} {totalTrips === 1 ? 'viaje' : 'viajes'}
                      </span>
                    </div>
                  </button>

                  {/* Trip list */}
                  {routeOpen && (
                    <div className="border-t border-slate-100">
                      {route.trips.map((trip) => {
                        const tripOpen = expandedTrips.has(trip.tripId);
                        const confirmed = trip.bookings.filter((b) => b.status === 'confirmed').length;
                        const cancelled = trip.bookings.filter((b) => b.status === 'cancelled').length;
                        const occupancy = trip.totalSeats > 0 ? Math.round((confirmed / trip.totalSeats) * 100) : 0;
                        const ts = TRIP_STATUS_STYLES[trip.tripStatus] ?? TRIP_STATUS_STYLES.active;

                        return (
                          <div key={trip.tripId}>
                            <button
                              type="button"
                              onClick={() => toggleTrip(trip.tripId)}
                              className={`w-full flex items-center gap-2.5 px-5 py-3.5 pl-9 border-none cursor-pointer text-left border-b border-slate-50 transition-colors duration-150 ${
                                tripOpen ? 'bg-slate-50' : 'bg-transparent'
                              }`}
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 12 12"
                                fill="none"
                                className={`shrink-0 transition-transform duration-200 ${tripOpen ? 'rotate-90' : ''}`}
                              >
                                <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <div className="flex-1 flex items-center gap-3 flex-wrap">
                                <span className="font-['Poppins',sans-serif] font-semibold text-[13px] text-brand-navy">
                                  {format(new Date(trip.departure_at), 'dd/MM/yyyy HH:mm')}
                                </span>
                                <span className={`inline-block font-['Poppins',sans-serif] font-semibold text-[10px] px-2 py-0.5 rounded-full ${ts.pill}`}>
                                  {ts.label}
                                </span>
                              </div>
                              <div className="flex gap-3.5 items-center shrink-0">
                                <div className="flex items-center gap-1">
                                  <div className="w-8 h-1 rounded-sm bg-slate-100 overflow-hidden">
                                    <div
                                      className="h-full rounded-sm transition-all duration-300"
                                      style={{
                                        width: `${occupancy}%`,
                                        background: occupancy > 80 ? '#10b981' : occupancy > 50 ? '#f59e0b' : '#00D4FF',
                                      }}
                                    />
                                  </div>
                                  <span className="font-['Poppins',sans-serif] font-semibold text-[10px] text-brand-muted min-w-[32px]">
                                    {confirmed}/{trip.totalSeats}
                                  </span>
                                </div>
                                {cancelled > 0 && (
                                  <span className="font-['Poppins',sans-serif] font-semibold text-[10px] text-red-500">
                                    -{cancelled}
                                  </span>
                                )}
                              </div>
                            </button>

                            {/* Passenger list */}
                            <div className={`grid transition-all duration-300 ease-in-out ${tripOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                              <div className="overflow-hidden">
                                <div className="px-4 sm:px-5 pb-3 sm:pl-12">
                                  {trip.bookings.length === 0 ? (
                                    <p className="font-['Poppins',sans-serif] font-normal text-[13px] text-gray-400 py-3">
                                      Sin pasajeros en este viaje
                                    </p>
                                  ) : (
                                    <>
                                      {/* Desktop grid headers */}
                                      <div className="hidden sm:grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_70px_85px_45px] gap-2 py-2 border-b border-slate-100 items-center">
                                        <span className="font-['Poppins',sans-serif] font-semibold text-[10px] text-brand-muted uppercase tracking-wider">Pasajero</span>
                                        <span className="font-['Poppins',sans-serif] font-semibold text-[10px] text-brand-muted uppercase tracking-wider">Cédula</span>
                                        <span className="font-['Poppins',sans-serif] font-semibold text-[10px] text-brand-muted uppercase tracking-wider">Asiento</span>
                                        <span className="font-['Poppins',sans-serif] font-semibold text-[10px] text-brand-muted uppercase tracking-wider">Estado</span>
                                        <span className="font-['Poppins',sans-serif] font-semibold text-[10px] text-brand-muted uppercase tracking-wider">Código</span>
                                      </div>
                                      {/* Desktop grid rows + Mobile cards */}
                                      {trip.bookings.map((b, idx) => {
                                        const bs = STATUS_STYLES[b.status] ?? STATUS_STYLES.confirmed;
                                        return (
                                          <div
                                            key={b.id}
                                            style={{ animationDelay: `${idx * 30}ms` }}
                                            className="animate-[fadeSlideIn_0.3s_ease-out_both]"
                                          >
                                            {/* Desktop row */}
                                            <div
                                              onClick={() => router.push(`/admin/bookings/${b.id}`)}
                                              className="hidden sm:grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_70px_85px_45px] gap-2 py-2.5 border-b border-slate-50 items-center hover:bg-slate-50 transition-colors cursor-pointer"
                                            >
                                              <span className="font-['Poppins',sans-serif] font-medium text-[13px] text-brand-navy truncate">
                                                {b.passenger_name}
                                              </span>
                                              <span className="font-['Poppins',sans-serif] font-normal text-xs text-brand-muted">
                                                {b.passenger_cedula ?? '—'}
                                              </span>
                                              <span className="font-['Poppins',sans-serif] font-bold text-[13px] text-brand-navy bg-slate-100 inline-block px-2.5 py-0.5 rounded-md text-center w-fit">
                                                {b.seat?.seat_code ?? '—'}
                                              </span>
                                              <span className={`inline-block font-['Poppins',sans-serif] font-semibold text-[10px] px-2 py-0.5 rounded-full text-center w-fit ${bs.pill}`}>
                                                {bs.label}
                                              </span>
                                              <span className="font-['Poppins',sans-serif] font-normal text-[10px] text-brand-muted tabular-nums">
                                                {b.qr_code?.split('-').pop() ?? '—'}
                                              </span>
                                            </div>

                                            {/* Mobile card */}
                                            <div
                                              onClick={() => router.push(`/admin/bookings/${b.id}`)}
                                              className="sm:hidden bg-white rounded-xl p-3.5 mb-2 border border-slate-100 shadow-sm cursor-pointer active:scale-[0.98] transition-transform"
                                            >
                                              <div className="flex items-start justify-between gap-2 mb-2">
                                                <div className="min-w-0 flex-1">
                                                  <p className="font-['Poppins',sans-serif] font-semibold text-[13px] text-brand-navy truncate">
                                                    {b.passenger_name}
                                                  </p>
                                                  <p className="font-['Poppins',sans-serif] font-normal text-[11px] text-brand-muted mt-0.5">
                                                    {b.passenger_cedula ?? '—'}
                                                  </p>
                                                </div>
                                                <span className={`shrink-0 inline-block font-['Poppins',sans-serif] font-semibold text-[10px] px-2 py-0.5 rounded-full ${bs.pill}`}>
                                                  {bs.label}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-3">
                                                <div className="font-['Poppins',sans-serif] font-bold text-[13px] text-brand-navy bg-slate-100 inline-block px-2.5 py-0.5 rounded-md">
                                                  {b.seat?.seat_code ?? '—'}
                                                </div>
                                                <span className="font-['Poppins',sans-serif] font-normal text-[10px] text-brand-muted tabular-nums">
                                                  {b.qr_code?.split('-').pop() ?? '—'}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </>
                                  )}
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
      </div>
  );
}
