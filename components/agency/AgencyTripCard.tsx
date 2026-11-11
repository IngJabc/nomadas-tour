"use client";

import Link from "next/link";
import {
  Bus,
  Calendar,
  Clock,
  Users,
  ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { formatDateLong, formatTime12h } from "@/lib/timezone";
import {
  isDepartureInFuture,
  isTripOpenForReservation,
} from "@/lib/reservations/bookableTrips";

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
  postponed_from?: string | null;
  /**
   * AS-TRIP-002 — número de agencias asignadas al viaje. `1` = exclusivo
   * de esta agencia. Solo entonces se muestra la acción "Completar viaje"
   * (el backend vuelve a validar en el PATCH de estado).
   */
  agency_count?: number;
}

interface AgencyTripCardProps {
  trip: AgencyTrip;
  onSelect?: (tripId: string) => void;
  now?: Date;
  /** AS-TRIP-002 — habilita la acción "Completar viaje" en el footer. */
  onComplete?: (trip: AgencyTrip) => void;
  /** true mientras el PATCH de estado de ESTE viaje está en curso. */
  completing?: boolean;
}

function getStatusBadge(
  trip: AgencyTrip,
  now: Date,
) {
  if (
    trip.status === 'active' &&
    !isDepartureInFuture(trip.departure_time, now)
  ) {
    return { label: 'Ya salió', variant: 'warning' as const };
  }
  if (trip.postponed_from) return { label: 'Reprogramado', variant: 'warning' as const };
  switch (trip.status) {
    case 'cancelled': return { label: 'Cancelado', variant: 'cancelled' as const };
    case 'completed': return { label: 'Completado', variant: 'completed' as const };
    case 'active': return { label: 'Programado', variant: 'active' as const };
    default: return null;
  }
}

export function AgencyTripCard({ trip, onSelect, now, onComplete, completing }: AgencyTripCardProps) {
  const clock = now ?? new Date();
  const isFull = trip.available_seats === 0;
  const isClosed = trip.status === 'cancelled' || trip.status === 'completed';
  const canCreateReservation = isTripOpenForReservation(trip, clock);
  const statusBadge = getStatusBadge(trip, clock);

  // AS-TRIP-002 — visibilidad de "Completar viaje":
  //   * viaje activo (no completado ni cancelado),
  //   * exclusivo de esta agencia (agency_count === 1),
  //   * ya salió (el backend rechaza completar antes de la salida).
  // La autorización real siempre la decide el backend; esto es solo
  // visibilidad para no ofrecer una acción que siempre fallaría.
  const canComplete =
    trip.status === 'active' &&
    trip.agency_count === 1 &&
    !isDepartureInFuture(trip.departure_time, clock);
  const showComplete = Boolean(onComplete) && canComplete;

  const cardContent = (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {statusBadge && (
          <Badge variant={statusBadge.variant} size="sm">
            {statusBadge.label}
          </Badge>
        )}
        {isFull && !onSelect && (
          <Badge variant="cancelled" size="sm">
            Completo
          </Badge>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <Tooltip content={trip.route?.destination ?? "?"} className="block max-w-full">
            <h3 className="font-[family-name:var(--font-heading)] font-bold text-[18px] text-[var(--color-brand-navy)] mb-1 truncate cursor-default">
              {trip.route?.destination ?? "?"}
            </h3>
          </Tooltip>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--color-brand-muted)] mt-2">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              {formatDateLong(trip.departure_time)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              {formatTime12h(trip.departure_time)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Bus className="w-3.5 h-3.5 shrink-0" />
              {trip.vehicle_type === "bus" ? "Autobús" : "Kia"} ·{" "}
              {trip.total_seats} puestos
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6 shrink-0">
          <div className="text-center">
            <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
              Disponible
            </p>
            <p
              className={`font-[family-name:var(--font-heading)] font-bold text-[22px] ${
                isFull
                  ? "text-[var(--color-brand-muted)]"
                  : "text-[var(--color-brand-cyan)]"
              }`}
            >
              {trip.available_seats}
            </p>
          </div>
          <div className="text-center">
            <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
              Reservado
            </p>
            <p className="font-[family-name:var(--font-heading)] font-bold text-[22px] text-[var(--color-brand-navy)]">
              {trip.reserved_seats}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-[rgba(0,0,0,0.06)] flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px] text-[var(--color-brand-muted)]">
          <Users className="w-3.5 h-3.5" />
          <span>
            {isClosed
              ? trip.status === 'cancelled' ? 'Viaje cancelado' : 'Viaje completado'
              : trip.total_seats - trip.available_seats - trip.reserved_seats > 0
                ? `${trip.total_seats - trip.available_seats - trip.reserved_seats} en proceso`
                : "Sin bloqueos"
            }
          </span>
        </div>

        {onSelect ? (
          <ChevronRight className={`w-5 h-5 transition-colors ${isClosed ? 'text-[var(--color-brand-muted)] opacity-40' : 'text-[var(--color-brand-muted)] group-hover:text-[var(--color-brand-cyan)]'}`} />
        ) : (
          <div className="flex items-center gap-3">
            {showComplete && (
              <>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={completing}
                  onClick={(e) => {
                    // La tarjeta no está envuelta en <Link> cuando hay
                    // acción de completar; se detiene la propagación por
                    // seguridad (nunca debe navegar ni duplicar el envío).
                    e.preventDefault();
                    e.stopPropagation();
                    onComplete?.(trip);
                  }}
                >
                  Completar viaje
                </Button>
                {/* showComplete implica viaje activo: siempre hay al
                    menos el enlace "Ver pasajeros" después. */}
                <span className="text-[var(--color-brand-muted)] opacity-40">|</span>
              </>
            )}
            {!isClosed && (
              <Link
                href={`/agency/trips/${trip.id}/passengers`}
                className="inline-flex items-center gap-1 text-[12px] font-[family-name:var(--font-body)] font-medium text-[var(--color-brand-muted)] hover:text-[var(--color-brand-cyan)] transition-colors no-underline"
                onClick={(e) => e.stopPropagation()}
              >
                Ver pasajeros
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            )}
            {!isClosed && canCreateReservation && (
              <>
                <span className="text-[var(--color-brand-muted)] opacity-40">|</span>
                <Link
                  href={`/agency/reservations/new?trip=${trip.id}&source=trips`}
                  className="inline-flex items-center gap-1 text-[12px] font-[family-name:var(--font-body)] font-medium text-[var(--color-brand-muted)] hover:text-[var(--color-brand-cyan)] transition-colors no-underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Nueva Reserva
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );

  if (onSelect) {
    return (
      <div className={isClosed ? "" : "group"}>
        <Card hover={!isClosed}>
          <button
            type="button"
            onClick={() => { if (!isClosed) onSelect(trip.id); }}
            disabled={isClosed}
            className={`w-full text-left bg-transparent border-none p-0 ${isClosed ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {cardContent}
          </button>
        </Card>
      </div>
    );
  }

  if (isClosed) {
    return (
      <div className="cursor-not-allowed">
        <Card>
          {cardContent}
        </Card>
      </div>
    );
  }

  // AS-TRIP-002: si hay acción "Completar viaje", la tarjeta NO se
  // envuelve en <Link> para no anidar elementos interactivos (el botón
  // vive en el footer junto a "Ver pasajeros", que sigue navegando).
  if (showComplete) {
    return (
      <div className="group">
        <Card hover>
          {cardContent}
        </Card>
      </div>
    );
  }

  return (
    <Link href={`/agency/trips/${trip.id}/passengers`} className="no-underline block">
      <div className="group">
        <Card hover>
          {cardContent}
        </Card>
      </div>
    </Link>
  );
}
