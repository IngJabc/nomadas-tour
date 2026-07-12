'use client';

import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, MapPin, Users, Bus } from 'lucide-react';
import { Seat } from '@/types';

interface PassengerData {
  seat_id: string;
  seat_code: string;
  name: string;
  document: string;
  phone: string;
}

interface ReservationSummaryProps {
  trip: any;
  selectedSeats: Seat[];
  passengers: PassengerData[];
  bookerName: string;
  bookerDocument: string;
  onConfirm: () => void;
  loading: boolean;
  error: string | null;
}

export function ReservationSummary({
  trip,
  selectedSeats,
  passengers,
  bookerName,
  bookerDocument,
  onConfirm,
  loading,
  error,
}: ReservationSummaryProps) {
  const vehicleLabel = trip.vehicle_type === 'bus' ? 'Autobús (31 asientos)' : 'KIA (10 asientos)';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-[18px] bg-[var(--color-brand-cyan)] rounded-sm" />
        <h3 className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]">
          Resumen de reserva
        </h3>
      </div>

      {/* Trip info */}
      <div className="bg-[var(--color-page-bg)] rounded-xl p-4 border border-[rgba(0,0,0,0.06)]">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-start gap-3">
            <MapPin className="w-4 h-4 text-[var(--color-brand-cyan)] mt-0.5 shrink-0" />
            <div>
              <p className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-navy)]">
                {trip.routes?.origin ?? ''} → {trip.routes?.destination ?? ''}
              </p>
              <p className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">
                Ruta del viaje
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Calendar className="w-4 h-4 text-[var(--color-brand-cyan)] mt-0.5 shrink-0" />
            <div>
              <p className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-navy)]">
                {format(new Date(trip.departure_time), "d 'de' MMMM, HH:mm", { locale: es })}
              </p>
              <p className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">
                Fecha y hora de salida
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Bus className="w-4 h-4 text-[var(--color-brand-cyan)] mt-0.5 shrink-0" />
            <div>
              <p className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-navy)]">
                {vehicleLabel}
              </p>
              <p className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">
                Tipo de vehículo
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Users className="w-4 h-4 text-[var(--color-brand-cyan)] mt-0.5 shrink-0" />
            <div>
              <p className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-navy)]">
                {selectedSeats.length} pasajero{selectedSeats.length !== 1 ? 's' : ''}
              </p>
              <p className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">
                Asientos: {selectedSeats.map((s) => s.seat_code).join(', ')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Booker info */}
      <div className="bg-[var(--color-page-bg)] rounded-xl p-4 border border-[rgba(0,0,0,0.06)]">
        <p className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-navy)] mb-2">
          Datos del comprador
        </p>
        <div className="flex gap-6 text-sm">
          <div>
            <span className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">Nombre:</span>
            <p className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)]">{bookerName}</p>
          </div>
          <div>
            <span className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">Documento:</span>
            <p className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)]">{bookerDocument}</p>
          </div>
        </div>
      </div>

      {/* Passengers list */}
      <div className="bg-[var(--color-page-bg)] rounded-xl p-4 border border-[rgba(0,0,0,0.06)]">
        <p className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-navy)] mb-2">
          Pasajeros
        </p>
        <div className="space-y-2">
          {passengers.map((p, i) => (
            <div key={p.seat_id} className="flex items-center gap-3">
              <span className="font-[family-name:var(--font-body)] font-bold text-[13px] text-[var(--color-brand-cyan)] bg-[rgba(0,212,255,0.1)] px-2 py-0.5 rounded-md min-w-[36px] text-center">
                {p.seat_code}
              </span>
              <span className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)]">
                {p.name}
              </span>
              <span className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">
                {p.document}
              </span>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-[#fef2f2] border border-[#fee2e2] font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onConfirm}
        disabled={loading}
        className="w-full px-6 py-3 bg-[var(--color-brand-cyan)] text-white font-[family-name:var(--font-body)] font-semibold text-sm rounded-xl border-none cursor-pointer transition-all duration-200 hover:bg-[var(--color-brand-blue)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Procesando...
          </>
        ) : (
          'Confirmar reserva'
        )}
      </button>
    </div>
  );
}
