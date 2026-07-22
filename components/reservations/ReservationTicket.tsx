'use client';

import { forwardRef } from 'react';
import { QRCode } from 'react-qr-code';
import { formatDateTimeShort, formatTime12h, formatDateShort } from '@/lib/timezone';
import { VEHICLE_LABELS, type ReservationTicketData } from '@/types/reservation';
import {
  MapPin,
  Calendar,
  Clock,
  Bus,
  User,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface ReservationTicketProps {
  reservation: ReservationTicketData;
  className?: string;
}

export const ReservationTicket = forwardRef<HTMLDivElement, ReservationTicketProps>(
  function ReservationTicket({ reservation, className }, ref) {
    const trip = reservation.trip;

    return (
      <div
        ref={ref}
        className={`bg-white rounded-2xl border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden ${className ?? ''}`}
      >
        {/* Header */}
        <div className="bg-[var(--color-brand-navy)] px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.15)] flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-[var(--color-brand-cyan)]" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-[family-name:var(--font-heading)] font-bold text-[15px] text-white">
              Boleto de viaje
            </h3>
            <p className="font-[family-name:var(--font-body)] text-[11px] text-white/60">
              Presenta este código QR al abordar
            </p>
          </div>
        </div>

        {/* QR Code */}
        <div className="flex flex-col items-center py-6 px-5">
          <div className="bg-white p-3 rounded-2xl border-2 border-[rgba(0,212,255,0.15)] shadow-[0_2px_12px_rgba(0,212,255,0.06)]">
            <QRCode value={reservation.qr_code} size={150} />
          </div>
          <p className="font-[family-name:var(--font-body)] font-medium text-[12px] text-[var(--color-brand-navy)] mt-3 break-all text-center">
            {reservation.qr_code}
          </p>
        </div>

        {/* Trip Info */}
        {trip && (
          <div className="px-5 pb-4">
            <div className="bg-[var(--color-page-bg)] rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-[family-name:var(--font-body)] text-[10px] text-[var(--color-brand-muted)] uppercase tracking-wider">
                    Ruta
                  </p>
                  <p className="font-[family-name:var(--font-heading)] font-bold text-[13px] text-[var(--color-brand-navy)] truncate">
                    {trip.origin} → {trip.destination}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
                  <div className="min-w-0">
                    <p className="font-[family-name:var(--font-body)] text-[10px] text-[var(--color-brand-muted)] uppercase tracking-wider">
                      Fecha
                    </p>
                    <p className="font-[family-name:var(--font-body)] font-medium text-[12px] text-[var(--color-brand-navy)] truncate">
                      {formatDateShort(trip.departure_time)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
                  <div className="min-w-0">
                    <p className="font-[family-name:var(--font-body)] text-[10px] text-[var(--color-brand-muted)] uppercase tracking-wider">
                      Salida
                    </p>
                    <p className="font-[family-name:var(--font-body)] font-medium text-[12px] text-[var(--color-brand-navy)]">
                      {formatTime12h(trip.departure_time)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Bus className="w-3.5 h-3.5 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
                  <div className="min-w-0">
                    <p className="font-[family-name:var(--font-body)] text-[10px] text-[var(--color-brand-muted)] uppercase tracking-wider">
                      Vehículo
                    </p>
                    <p className="font-[family-name:var(--font-body)] font-medium text-[12px] text-[var(--color-brand-navy)]">
                      {VEHICLE_LABELS[trip.vehicle_type] ?? trip.vehicle_type}
                    </p>
                  </div>
                </div>
              </div>

              {trip.postponed_from && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#fffbeb] border border-[#fde68a]">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#92400e] shrink-0" strokeWidth={1.75} />
                  <p className="font-[family-name:var(--font-body)] text-[11px] text-[#92400e]">
                    Viaje pospuesto — Salida original: {formatDateTimeShort(trip.postponed_from)}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Booker */}
        <div className="px-5 pb-4">
          <div className="bg-[var(--color-page-bg)] rounded-xl p-4">
            <p className="font-[family-name:var(--font-body)] font-semibold text-[12px] text-[var(--color-brand-navy)] mb-2">
              Reservador
            </p>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="font-[family-name:var(--font-heading)] font-bold text-[13px] text-[var(--color-brand-navy)] truncate">
                  {reservation.booker_name}
                </p>
                <div className="flex items-center gap-2">
                  <CreditCard className="w-3 h-3 text-[var(--color-brand-muted)]" strokeWidth={1.75} />
                  <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)]">
                    {reservation.booker_document}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Passengers */}
        {reservation.passengers.length > 0 && (
          <div className="px-5 pb-4">
            <div className="bg-[var(--color-page-bg)] rounded-xl p-4">
              <p className="font-[family-name:var(--font-body)] font-semibold text-[12px] text-[var(--color-brand-navy)] mb-3">
                Pasajeros ({reservation.passengers.length})
              </p>
              <div className="space-y-2">
                {reservation.passengers.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between py-1.5 border-b border-[rgba(0,0,0,0.06)] last:border-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-[family-name:var(--font-body)] font-bold text-[12px] text-[var(--color-brand-cyan)] bg-[rgba(0,212,255,0.1)] px-2 py-0.5 rounded-md min-w-[34px] text-center shrink-0">
                        {p.seat_code}
                      </span>
                      <span className="font-[family-name:var(--font-body)] font-medium text-[12px] text-[var(--color-brand-navy)] truncate">
                        {p.name || 'Sin nombre'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 bg-[var(--color-page-bg)] border-t border-[rgba(0,0,0,0.06)]">
          <p className="font-[family-name:var(--font-body)] text-[10px] text-[var(--color-brand-muted)] text-center uppercase tracking-wider">
            Código: {reservation.reservation_id.slice(0, 8).toUpperCase()}
          </p>
        </div>
      </div>
    );
  }
);
