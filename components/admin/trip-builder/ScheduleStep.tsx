'use client';

import { Clock } from 'lucide-react';
import { Label } from '@/components/form/Label';
import { DateTimePicker } from '@/components/ui/DateTimePicker';
import { formatInTimezone } from '@/lib/timezone';

interface ScheduleStepProps {
  departureTime: string;
  onChange: (value: string) => void;
}

export function ScheduleStep({ departureTime, onChange }: ScheduleStepProps) {
  return (
    <div className="w-fit max-w-full mx-auto flex flex-col gap-1.5">
      <Label>Fecha y hora de salida</Label>
      <DateTimePicker value={departureTime} onChange={onChange} />
      {departureTime && (
        <div className="mt-1 flex items-center justify-center gap-2 text-xs font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>
            Salida:{' '}
            {formatInTimezone(departureTime)}
          </span>
        </div>
      )}
    </div>
  );
}
