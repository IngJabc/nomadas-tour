'use client';

import { Calendar, Clock } from 'lucide-react';
import { Field } from '@/components/form';
import { formatInTimezone } from '@/lib/timezone';

const inputClass =
  "w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-white outline-none transition-all duration-200 focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]";

interface ScheduleStepProps {
  departureTime: string;
  onChange: (value: string) => void;
}

export function ScheduleStep({ departureTime, onChange }: ScheduleStepProps) {
  return (
    <div className="max-w-md">
      <Field label="Fecha y hora de salida">
        <div className="relative">
          <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-brand-muted)] pointer-events-none" />
          <input
            type="datetime-local"
            value={departureTime}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </div>
      </Field>
      {departureTime && (
        <div className="mt-3 flex items-center gap-2 text-xs font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
          <Clock className="w-3.5 h-3.5" />
          <span>
            Salida:{' '}
            {formatInTimezone(departureTime)}
          </span>
        </div>
      )}
    </div>
  );
}
