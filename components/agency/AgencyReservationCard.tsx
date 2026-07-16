"use client";

import Link from "next/link";
import {
  MapPin,
  Calendar,
  Users,
  ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { RESERVATION_STATUS_STYLES } from "@/lib/constants/reservation-status";
import type { AgencyReservation } from "@/types";

interface AgencyReservationCardProps {
  reservation: AgencyReservation;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function AgencyReservationCard({ reservation }: AgencyReservationCardProps) {
  const statusInfo = RESERVATION_STATUS_STYLES[reservation.status] ?? RESERVATION_STATUS_STYLES.confirmed;
  const passengers = reservation.reservation_passengers ?? [];
  const passengerCount = passengers.length;
  const boardedCount = passengers.filter((p) => p.boarded).length;
  const seatCodes = passengers
    .map((p) => p.seats?.seat_code)
    .filter(Boolean);

  const cardContent = (
    <>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-[family-name:var(--font-heading)] font-bold text-[17px] text-[var(--color-brand-navy)] truncate">
            {reservation.booker_name}
          </h3>
          <p className="font-[family-name:var(--font-body)] text-[12px] text-[var(--color-brand-muted)] mt-0.5">
            {reservation.booker_document}
          </p>
        </div>
        <Badge variant={statusInfo.variant} size="sm">
          {statusInfo.label}
        </Badge>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 text-[13px] text-[var(--color-brand-muted)]">
          <MapPin className="w-3.5 h-3.5 shrink-0 text-[var(--color-brand-cyan)]" />
          <span className="font-[family-name:var(--font-body)] truncate">
            {reservation.trips?.routes?.origin ?? "—"} → {reservation.trips?.routes?.destination ?? "—"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-[var(--color-brand-muted)]">
          <Calendar className="w-3.5 h-3.5 shrink-0 text-[var(--color-brand-cyan)]" />
          <span className="font-[family-name:var(--font-body)]">
            {reservation.trips?.departure_time
              ? `${formatDate(reservation.trips.departure_time)} · ${formatTime(reservation.trips.departure_time)}`
              : "—"}
          </span>
        </div>
      </div>

      {seatCodes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {seatCodes.map((code, i) => (
            <span
              key={i}
              className="font-[family-name:var(--font-heading)] font-bold text-[12px] text-[var(--color-brand-navy)] bg-slate-100 px-2 py-0.5 rounded-md"
            >
              {code}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-[12px] text-[var(--color-brand-muted)] mb-4">
        <span className="inline-flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          <span className="font-[family-name:var(--font-body)]">
            {passengerCount} {passengerCount === 1 ? "pasajero" : "pasajeros"}
          </span>
        </span>
        {passengerCount > 0 && (
          <>
            <span className="text-[var(--color-brand-muted)] opacity-40">·</span>
            <span
              className={`font-[family-name:var(--font-body)] font-semibold ${
                boardedCount === passengerCount
                  ? "text-[#10b981]"
                  : boardedCount > 0
                    ? "text-[#f59e0b]"
                    : ""
              }`}
            >
              {boardedCount}/{passengerCount} abordados
            </span>
          </>
        )}
      </div>

      <div className="pt-4 border-t border-[rgba(0,0,0,0.06)] flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12px] font-[family-name:var(--font-body)] font-medium text-[var(--color-brand-muted)]">
          <span className="font-[family-name:var(--font-heading)] text-[11px] font-bold text-[var(--color-brand-navy)] bg-slate-100 px-1.5 py-0.5 rounded">
            #{reservation.id.slice(0, 8)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[12px] font-[family-name:var(--font-body)] font-medium text-[var(--color-brand-muted)] group-hover:text-[var(--color-brand-cyan)] transition-colors">
          Ver reserva
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </div>
    </>
  );

  return (
    <Link href={`/agency/reservations/${reservation.id}`} className="no-underline block group">
      <Card hover>{cardContent}</Card>
    </Link>
  );
}
