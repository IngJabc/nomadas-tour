'use client';

import { forwardRef } from 'react';
import { formatDateLong, formatTime12h } from '@/lib/timezone';
import { VEHICLE_LABELS } from '@/types/reservation';
import { BusLayout } from './BusLayout';
import type { Seat } from '@/types';

interface TripInfo {
  origin: string;
  destination: string;
  departure_time: string;
}

interface BusLayoutSnapshotProps {
  seats: Record<string, Seat>;
  vehicleType: 'bus' | 'kia';
  trip: TripInfo | null;
  className?: string;
}

export const BusLayoutSnapshot = forwardRef<HTMLDivElement, BusLayoutSnapshotProps>(
  function BusLayoutSnapshot({ seats, vehicleType, trip, className }, ref) {
    return (
      <div
        ref={ref}
        className={`bg-white rounded-2xl border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden ${className ?? ''}`}
      >
        {trip && (
          <div className="px-5 py-4 border-b border-[rgba(0,0,0,0.06)]">
            <p className="font-[family-name:var(--font-heading)] font-bold text-[14px] text-[var(--color-brand-navy)] mb-1">
              Mapa de asientos
            </p>
            <p className="font-[family-name:var(--font-body)] font-medium text-[12px] text-[var(--color-brand-navy)]">
              {trip.origin} → {trip.destination}
            </p>
            <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] mt-0.5">
              {formatDateLong(trip.departure_time)} — {formatTime12h(trip.departure_time)} · {VEHICLE_LABELS[vehicleType] ?? vehicleType}
            </p>
          </div>
        )}

        <div className="px-4 py-4">
          <BusLayout
            seats={seats}
            selectedSeats={[]}
            vehicleType={vehicleType}
            mode="preview"
          />
        </div>

        <div className="px-5 py-3 border-t border-[rgba(0,0,0,0.06)] flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-[4px]" style={{ background: '#00D4FF' }} />
            <span className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)]">
              Disponible
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-[4px]" style={{ background: '#374151' }} />
            <span className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)]">
              Ocupado
            </span>
          </div>
        </div>
      </div>
    );
  }
);
