'use client';

import Link from 'next/link';
import { Bus, MapPin, Calendar, Clock, Users, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

interface AgencyTripRoute {
  origin: string;
  destination: string;
}

export interface AgencyTrip {
  id: string;
  route: AgencyTripRoute | null;
  departure_time: string;
  vehicle_type: string;
  status: string;
  total_seats: number;
  available_seats: number;
  reserved_seats: number;
}

interface AgencyTripCardProps {
  trip: AgencyTrip;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export function AgencyTripCard({ trip }: AgencyTripCardProps) {
  console.log('[AgencyTripCard] render', {
    tripId: trip.id,
    available_seats: trip.available_seats,
    reserved_seats: trip.reserved_seats,
  });

  const isFull = trip.available_seats === 0;

  return (
    <div className={isFull ? '' : 'group'}>
      <Card hover={!isFull} className={isFull ? 'opacity-70' : ''}>
        {isFull && (
          <div className="mb-3">
            <Badge variant="cancelled" size="sm">Completo</Badge>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-[family-name:var(--font-heading)] font-bold text-[18px] text-[var(--color-brand-navy)] mb-1">
              {trip.route?.origin ?? '?'} → {trip.route?.destination ?? '?'}
            </h3>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--color-brand-muted)] mt-2">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                {formatDate(trip.departure_time)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                {formatTime(trip.departure_time)} hs
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Bus className="w-3.5 h-3.5 shrink-0" />
                {trip.vehicle_type === 'bus' ? 'Autobús' : 'Kia'} · {trip.total_seats} puestos
              </span>
            </div>
          </div>

          <div className="flex items-center gap-6 shrink-0">
            <div className="text-center">
              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">Disponible</p>
              <p className={`font-[family-name:var(--font-heading)] font-bold text-[22px] ${isFull ? 'text-[var(--color-brand-muted)]' : 'text-[var(--color-brand-cyan)]'}`}>
                {trip.available_seats}
              </p>
            </div>
            <div className="text-center">
              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">Reservado</p>
              <p className="font-[family-name:var(--font-heading)] font-bold text-[22px] text-[var(--color-brand-navy)]">{trip.reserved_seats}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-[rgba(0,0,0,0.06)] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-brand-muted)]">
            <Users className="w-3.5 h-3.5" />
            <span>{trip.total_seats - trip.available_seats - trip.reserved_seats > 0
              ? `${trip.total_seats - trip.available_seats - trip.reserved_seats} en proceso`
              : 'Sin bloqueos'}</span>
          </div>

          {isFull ? (
            <Link href={`/agency/trips/${trip.id}`} className="no-underline">
              <Button variant="secondary" size="sm">
                Ver información
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          ) : (
            <Link href={`/agency/reservations/new?trip=${trip.id}`} className="no-underline">
              <Button size="sm">
                Nueva Reserva
              </Button>
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
