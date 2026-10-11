'use client';

import { Bus, DollarSign, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  COP_CENTS_PER_PESO,
  formatSeatPriceCents,
  parseSeatPricePesosInput,
} from '@/lib/price';

interface VehicleOption {
  type: 'bus' | 'kia';
  label: string;
  capacity: number;
  icon: typeof Bus;
}

const VEHICLES: VehicleOption[] = [
  { type: 'bus', label: 'Autobús', capacity: 31, icon: Bus },
  { type: 'kia', label: 'KIA', capacity: 10, icon: Bus },
];

interface VehicleStepProps {
  selectedType: 'bus' | 'kia' | '';
  onSelect: (type: 'bus' | 'kia') => void;
  /** Precio por puesto en pesos COP enteros (texto del input). */
  seatPriceInput: string;
  onSeatPriceInputChange: (value: string) => void;
}

export function VehicleStep({
  selectedType,
  onSelect,
  seatPriceInput,
  onSeatPriceInputChange,
}: VehicleStepProps) {
  const parsedPrice = parseSeatPricePesosInput(seatPriceInput);
  const showPriceError = parsedPrice.invalid;

  return (
    <div className="space-y-6 max-w-lg">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {VEHICLES.map((vehicle) => {
          const isSelected = selectedType === vehicle.type;
          const Icon = vehicle.icon;

          return (
            <button
              key={vehicle.type}
              type="button"
              onClick={() => onSelect(vehicle.type)}
              className={cn(
                'relative flex flex-col items-center gap-2 sm:gap-3 p-4 sm:p-6 rounded-2xl border-2 text-center transition-all duration-200 cursor-pointer',
                isSelected
                  ? 'border-[var(--color-brand-cyan)] bg-[rgba(0,212,255,0.06)] shadow-[0_0_0_3px_rgba(0,212,255,0.15)]'
                  : 'border-[rgba(0,0,0,0.06)] bg-[var(--color-brand-surface)] hover:border-[var(--color-brand-cyan)] hover:shadow-[0_6px_24px_rgba(0,212,255,0.12)] hover:-translate-y-0.5',
              )}
            >
              {isSelected && (
                <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[var(--color-brand-cyan)] flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              <div
                className={cn(
                  'w-14 h-14 sm:w-16 sm:h-16 rounded-xl flex items-center justify-center transition-colors duration-200',
                  isSelected ? 'bg-[var(--color-brand-cyan)]' : 'bg-[var(--color-brand-navy)]',
                )}
              >
                <Icon className={cn('w-7 h-7 sm:w-8 sm:h-8', isSelected ? 'text-white' : 'text-[var(--color-brand-cyan)]')} />
              </div>
              <div>
                <p className="font-[family-name:var(--font-heading)] font-bold text-[16px] sm:text-[18px] text-[var(--color-brand-navy)]">
                  {vehicle.label}
                </p>
                <div className="flex items-center justify-center gap-1.5 mt-1">
                  <Users className="w-3.5 h-3.5 text-[var(--color-brand-muted)]" />
                  <span className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)]">
                    {vehicle.capacity} puestos
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div>
        <label
          htmlFor="trip-seat-price"
          className="block font-[family-name:var(--font-body)] font-medium text-[12px] uppercase tracking-wide text-[var(--color-brand-muted)] mb-2"
        >
          Precio por puesto (COP)
        </label>
        <div className="relative">
          <DollarSign
            className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-brand-muted)] pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="trip-seat-price"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={seatPriceInput}
            onChange={(e) => onSeatPriceInputChange(e.target.value)}
            placeholder="Ej. 250000"
            aria-invalid={showPriceError}
            aria-describedby="trip-seat-price-hint"
            className={cn(
              'w-full pl-10 pr-4 py-3 rounded-[10px] border-[1.5px] font-[family-name:var(--font-body)] text-[14px] text-[var(--color-brand-navy)] bg-[var(--color-brand-surface)] transition-all duration-200',
              showPriceError
                ? 'border-[#ef4444] focus:outline-none focus:border-[#ef4444] focus:shadow-[0_0_0_3px_rgba(239,68,68,0.15)]'
                : 'border-[#e5e7eb] focus:outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]',
            )}
          />
        </div>
        <div className="mt-2 min-h-[18px]" aria-live="polite">
          {showPriceError ? (
            <p className="font-[family-name:var(--font-body)] text-[12px] text-[#ef4444]">
              Ingresa un precio entero en pesos COP, sin decimales ni puntos.
            </p>
          ) : parsedPrice.cents !== null ? (
            <p className="font-[family-name:var(--font-body)] text-[12px] text-[var(--color-brand-muted)]">
              Se publicará como {formatSeatPriceCents(parsedPrice.cents)} por puesto
              {` (almacenado en ${parsedPrice.cents} centavos).`}
            </p>
          ) : (
            <p id="trip-seat-price-hint" className="font-[family-name:var(--font-body)] text-[12px] text-[var(--color-brand-muted)]">
              Entero en pesos COP. Se guarda en centavos (×{COP_CENTS_PER_PESO}) en trips.seat_price.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
