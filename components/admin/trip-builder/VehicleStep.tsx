'use client';

import { Bus, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

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
}

export function VehicleStep({ selectedType, onSelect }: VehicleStepProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
      {VEHICLES.map((vehicle) => {
        const isSelected = selectedType === vehicle.type;
        const Icon = vehicle.icon;

        return (
          <button
            key={vehicle.type}
            type="button"
            onClick={() => onSelect(vehicle.type)}
            className={cn(
              'relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 text-center transition-all duration-200 cursor-pointer',
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
                'w-16 h-16 rounded-xl flex items-center justify-center transition-colors duration-200',
                isSelected ? 'bg-[var(--color-brand-cyan)]' : 'bg-[var(--color-brand-navy)]',
              )}
            >
              <Icon className={cn('w-8 h-8', isSelected ? 'text-white' : 'text-[var(--color-brand-cyan)]')} />
            </div>
            <div>
              <p className="font-[family-name:var(--font-heading)] font-bold text-[18px] text-[var(--color-brand-navy)]">
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
  );
}
