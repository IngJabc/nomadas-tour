"use client";

import { Check, CreditCard, Users, Bus, AlertTriangle } from "lucide-react";
import { Trip, PassengerData, Seat } from "@/types";
import { Button } from "@/components/ui/Button";
import { formatDateLong } from "@/lib/timezone";

interface ReservationSummaryProps {
  trip: Trip | null;
  selectedSeats: Seat[];
  bookerName: string;
  bookerDocument: string;
  passengers: PassengerData[];
  onConfirm: () => void;
  submitting?: boolean;
  submitError?: string | null;
  onEditPassengers?: () => void;
}

const VEHICLE_LABELS: Record<string, string> = {
  bus: "Autobús",
  kia: "KIA",
  van: "Van",
  microbús: "Microbús",
};

function getVehicleLabel(trip: Trip): string {
  const label = VEHICLE_LABELS[trip.vehicle_type] || trip.vehicle_type;
  return trip.capacity ? `${label} (${trip.capacity} asientos)` : label;
}

export function ReservationSummary({
  trip,
  selectedSeats,
  bookerName,
  bookerDocument,
  passengers,
  onConfirm,
  submitting = false,
  submitError,
  onEditPassengers,
}: ReservationSummaryProps) {
  if (!trip) return null;

  return (
    <div className="space-y-5">
      <div className="bg-white border border-[rgba(0,0,0,0.06)] rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-lg bg-[var(--color-brand-cyan)] text-white flex items-center justify-center">
            <Bus className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--color-brand-navy)]">
              {trip.routes?.destination}
            </p>
            <p className="text-xs text-[var(--color-brand-muted)]">
              {trip.departure_time
                ? formatDateLong(trip.departure_time)
                : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[rgba(0,0,0,0.06)] rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-[#f0fdf4] text-[#059669] flex items-center justify-center">
              <CreditCard className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-[var(--color-brand-navy)]">
              Reservante
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider mb-1">
              Nombre
            </p>
            <p className="text-sm font-medium text-[var(--color-brand-navy)]">
              {bookerName}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider mb-1">
              Documento
            </p>
            <p className="text-sm font-medium text-[var(--color-brand-navy)]">
              {bookerDocument}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[rgba(0,0,0,0.06)] rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-[#eff6ff] text-[#2563eb] flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-[var(--color-brand-navy)]">
              Pasajeros ({passengers.length})
            </p>
          </div>
          {onEditPassengers && (
            <button
              type="button"
              onClick={onEditPassengers}
              className="text-xs font-medium text-[var(--color-brand-cyan)] hover:underline"
            >
              Editar
            </button>
          )}
        </div>
        <div className="space-y-2">
          {passengers.map((p) => (
            <div
              key={p.seat_id}
              className="flex items-center justify-between py-2 border-b border-[rgba(0,0,0,0.06)] last:border-0"
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-brand-cyan)] text-white flex items-center justify-center text-xs font-bold">
                  {p.seat_code}
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-brand-navy)]">
                    {p.name || "Sin nombre"}
                  </p>
                  <p className="text-xs text-[var(--color-brand-muted)]">
                    {p.document || "Sin documento"}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-[var(--color-brand-muted)]">
                  {p.phone || "Sin teléfono"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {submitError && (
        <div className="bg-[#fef2f2] border border-[#fecaca] rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5" />
          <p className="text-sm text-[#ef4444]">{submitError}</p>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button
          variant="primary"
          onClick={onConfirm}
          loading={submitting}
          disabled={submitting}
        >
          Confirmar Reserva
        </Button>
      </div>
    </div>
  );
}
