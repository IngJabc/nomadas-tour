'use client';

import { useParams } from 'next/navigation';
import {
  Bus,
  Calendar,
  Clock,
  Users,
  MapPin,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { BusLayout } from '@/components/bus/BusLayout';
import { useTripRealtime } from '@/hooks/useTripRealtime';

const STATUS_STYLES: Record<string, { label: string; variant: 'active' | 'completed' | 'cancelled' | 'warning' }> = {
  active: { label: 'Activo', variant: 'active' },
  completed: { label: 'Completado', variant: 'completed' },
  cancelled: { label: 'Cancelado', variant: 'cancelled' },
  postponed: { label: 'Pospuesto', variant: 'warning' },
};

const VEHICLE_LABELS: Record<string, string> = {
  bus: 'Autobús',
  kia: 'KIA',
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }),
    time: d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
  };
}

export default function AdminTripDetailPage() {
  const params = useParams();
  const tripId = params.tripId as string;
  const { trip, seats, reservations, passengers, agencies, seatInfo, stats, loading, error } =
    useTripRealtime(tripId);

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <CardSkeleton />
      </main>
    );
  }

  if (error || !trip) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader
          title="Viaje no encontrado"
        />
        <div className="p-3 rounded-xl bg-[#fef2f2] border border-[#fee2e2] font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
          {error || 'El viaje no existe o no está disponible'}
        </div>
      </main>
    );
  }

  const route = trip.routes;
  const s = STATUS_STYLES[trip.status] ?? STATUS_STYLES.active;
  const dt = formatDateTime(trip.departure_time);
  const occupied = stats.total - stats.available;

  // Override seat status for boarded passengers
  const effectiveSeats = { ...seats };
  for (const p of passengers) {
    const code = p.seats?.seat_code;
    if (code && p.boarded && effectiveSeats[code]) {
      effectiveSeats[code] = { ...effectiveSeats[code], status: 'boarded' };
    }
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-4">
        <Link
          href="/admin/trips"
          className="inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver a viajes
        </Link>
      </div>

      <PageHeader
        title={route ? `${route.origin} → ${route.destination}` : 'Detalle del viaje'}
        action={
          <Badge variant={s.variant} size="md">
            {s.label}
          </Badge>
        }
      />

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left column: info, metrics, agencies, passengers */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Trip Info */}
          <Card>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5 text-[var(--color-brand-cyan)]" />
                </div>
                <div>
                  <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">Ruta</p>
                  <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                    {route?.origin ?? '?'} → {route?.destination ?? '?'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                  <Calendar className="w-5 h-5 text-[var(--color-brand-cyan)]" />
                </div>
                <div>
                  <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">Fecha</p>
                  <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">{dt.date}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5 text-[var(--color-brand-cyan)]" />
                </div>
                <div>
                  <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">Hora</p>
                  <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">{dt.time} hs</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                  <Bus className="w-5 h-5 text-[var(--color-brand-cyan)]" />
                </div>
                <div>
                  <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">Vehículo</p>
                  <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                    {VEHICLE_LABELS[trip.vehicle_type] || trip.vehicle_type} · {stats.total} puestos
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* Metrics KPIs */}
          <Card>
            <SectionTitle as="h3" className="mb-4">Ocupación</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center p-3 rounded-xl bg-[rgba(0,212,255,0.08)]">
                <p className="font-[family-name:var(--font-body)] font-normal text-[10px] text-[var(--color-brand-muted)] uppercase tracking-wide mb-1">Disponibles</p>
                <p className={`font-[family-name:var(--font-heading)] font-bold text-[24px] ${stats.available > 0 ? 'text-[var(--color-brand-cyan)]' : 'text-[var(--color-brand-muted)]'}`}>
                  {stats.available}
                </p>
              </div>
              <div className="text-center p-3 rounded-xl bg-[#f1f5f9]">
                <p className="font-[family-name:var(--font-body)] font-normal text-[10px] text-[var(--color-brand-muted)] uppercase tracking-wide mb-1">Ocupados</p>
                <p className="font-[family-name:var(--font-heading)] font-bold text-[24px] text-[var(--color-brand-navy)]">
                  {occupied}
                </p>
              </div>
              <div className="text-center p-3 rounded-xl bg-[#ecfdf5]">
                <p className="font-[family-name:var(--font-body)] font-normal text-[10px] text-[var(--color-brand-muted)] uppercase tracking-wide mb-1">Abordados</p>
                <p className="font-[family-name:var(--font-heading)] font-bold text-[24px] text-[#059669]">
                  {stats.boarded}
                </p>
              </div>
              <div className="text-center p-3 rounded-xl bg-[#fffbeb]">
                <p className="font-[family-name:var(--font-body)] font-normal text-[10px] text-[var(--color-brand-muted)] uppercase tracking-wide mb-1">Pendientes</p>
                <p className="font-[family-name:var(--font-heading)] font-bold text-[24px] text-[#92400e]">
                  {occupied - stats.boarded}
                </p>
              </div>
            </div>
          </Card>

          {/* Agencies */}
          <Card>
            <SectionTitle as="h3" className="mb-4">Agencias</SectionTitle>
            {agencies.length === 0 ? (
              <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                No hay agencias asignadas
              </p>
            ) : (
              <div className="space-y-3">
                {agencies.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between py-2 px-3 rounded-xl bg-[#f8fafc]"
                  >
                    <p className="font-[family-name:var(--font-body)] font-semibold text-[13px] text-[var(--color-brand-navy)]">
                      {a.name}
                    </p>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
                        {a.count} pasajeros
                      </span>
                      <Badge variant={a.boarded === a.count && a.count > 0 ? 'active' : a.boarded > 0 ? 'warning' : 'inactive'} size="xs">
                        {a.boarded}/{a.count} abordados
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Passenger List */}
          <Card>
            <SectionTitle as="h3" className="mb-4">Pasajeros ({passengers.length})</SectionTitle>
            {passengers.length === 0 ? (
              <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                No hay pasajeros registrados
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-[rgba(0,0,0,0.06)]">
                      <th className="pb-2 font-[family-name:var(--font-body)] font-semibold text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">Nombre</th>
                      <th className="pb-2 font-[family-name:var(--font-body)] font-semibold text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">Asiento</th>
                      <th className="pb-2 font-[family-name:var(--font-body)] font-semibold text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">Documento</th>
                      <th className="pb-2 font-[family-name:var(--font-body)] font-semibold text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {passengers.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-[rgba(0,0,0,0.04)] last:border-b-0"
                      >
                        <td className="py-2.5 font-[family-name:var(--font-body)] text-[13px] text-[var(--color-brand-navy)]">
                          {p.name}
                        </td>
                        <td className="py-2.5 font-[family-name:var(--font-body)] text-[13px] text-[var(--color-brand-muted)]">
                          {p.seats?.seat_code || '-'}
                        </td>
                        <td className="py-2.5 font-[family-name:var(--font-body)] text-[13px] text-[var(--color-brand-muted)]">
                          {p.document || '-'}
                        </td>
                        <td className="py-2.5">
                          <Badge
                            variant={p.boarded ? 'boarded' : 'inactive'}
                            size="xs"
                          >
                            {p.boarded ? 'Abordado' : 'Pendiente'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Right column: Bus Layout */}
        <div className="w-full lg:w-[400px] xl:w-[420px] shrink-0">
          <div className="sticky top-24">
            <Card>
              <SectionTitle as="h3" className="mb-4">Mapa de asientos</SectionTitle>
              <BusLayout
                seats={effectiveSeats}
                selectedSeats={[]}
                vehicleType={trip.vehicle_type || 'bus'}
                seatInfo={seatInfo}
              />
              {/* Legend */}
              <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-[rgba(0,0,0,0.06)]">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ background: 'linear-gradient(180deg, #00D4FF 0%, #00D4FF 52%, #00b8d9 52%, #00b8d9 100%)' }} />
                  <span className="font-[family-name:var(--font-body)] text-[10px] text-[var(--color-brand-muted)]">Disponible</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ background: 'linear-gradient(180deg, #374151 0%, #374151 52%, #1f2937 52%, #1f2937 100%)' }} />
                  <span className="font-[family-name:var(--font-body)] text-[10px] text-[var(--color-brand-muted)]">Reservado</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ background: 'linear-gradient(180deg, #10b981 0%, #10b981 52%, #059669 52%, #059669 100%)' }} />
                  <span className="font-[family-name:var(--font-body)] text-[10px] text-[var(--color-brand-muted)]">Abordado</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
