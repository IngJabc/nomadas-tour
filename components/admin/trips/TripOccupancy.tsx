'use client';

import { cn } from '@/lib/utils';

interface TripOccupancyProps {
  total: number;
  available: number;
  reserved: number;
  boarded: number;
  className?: string;
}

export function TripOccupancy({ total, available, reserved, boarded, className }: TripOccupancyProps) {
  const occupied = total - available;
  const pct = total > 0 ? (occupied / total) * 100 : 0;
  const boardedPct = total > 0 ? (boarded / total) * 100 : 0;
  const reservedPct = total > 0 ? (reserved / total) * 100 : 0;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-[#10b981] transition-all duration-300"
          style={{ width: `${boardedPct}%` }}
        />
        <div
          className="h-full bg-[#f59e0b] transition-all duration-300"
          style={{ width: `${reservedPct - boardedPct}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-navy)]">
          {occupied}/{total}
        </span>
        <span className="font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-navy)]">
          {Math.round(pct)}%
        </span>
      </div>
      <div className="flex gap-4 text-xs">
        <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
          <span className="inline-block w-2 h-2 rounded-full bg-[#10b981] mr-1" />
          Abordado: {boarded}
        </span>
        <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
          <span className="inline-block w-2 h-2 rounded-full bg-[#f59e0b] mr-1" />
          Reservado: {reserved}
        </span>
        <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
          <span className="inline-block w-2 h-2 rounded-full bg-slate-200 mr-1" />
          Disponible: {available}
        </span>
      </div>
    </div>
  );
}
