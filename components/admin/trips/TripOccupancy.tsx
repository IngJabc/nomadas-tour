"use client";

import { cn } from "@/lib/utils";

interface TripOccupancyProps {
  total: number;
  available: number;
  reserved: number;
  locked: number;
  blocked: number;
  boarded: number;
  className?: string;
}

export function TripOccupancy({
  total,
  available,
  reserved,
  locked,
  blocked,
  boarded,
  className,
}: TripOccupancyProps) {
  const occupied = total - available;
  const pct = total > 0 ? (occupied / total) * 100 : 0;
  const boardedPct = total > 0 ? (boarded / total) * 100 : 0;
  const reservedPct = total > 0 ? (reserved / total) * 100 : 0;
  const lockedPct = total > 0 ? (locked / total) * 100 : 0;
  const blockedPct = total > 0 ? (blocked / total) * 100 : 0;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-[#10b981] transition-all duration-300"
          style={{ width: `${boardedPct}%` }}
        />
        <div
          className="h-full bg-[#f59e0b] transition-all duration-300"
          style={{ width: `${reservedPct}%` }}
        />
        {locked > 0 && (
          <div
            className="h-full bg-[var(--color-brand-cyan)] transition-all duration-300 animate-pulse"
            style={{ width: `${lockedPct}%` }}
          />
        )}
        {blocked > 0 && (
          <div
            className="h-full bg-[var(--color-brand-navy)] transition-all duration-300"
            style={{ width: `${blockedPct}%` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-navy)]">
          {occupied}/{total}
        </span>
        <span className="font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-navy)]">
          {Math.round(pct)}%
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {boarded > 0 && (
          <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
            <span className="inline-block w-2 h-2 rounded-full bg-[#10b981] mr-1" />
            Abordados: {boarded}
          </span>
        )}
        {reserved > 0 && (
          <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
            <span className="inline-block w-2 h-2 rounded-full bg-[#f59e0b] mr-1" />
            Reservados: {reserved}
          </span>
        )}
        {locked > 0 && (
          <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-brand-cyan)] mr-1 animate-pulse" />
            Selección: {locked}
          </span>
        )}
        {blocked > 0 && (
          <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-brand-navy)] mr-1" />
            Bloqueados: {blocked}
          </span>
        )}
        <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]">
          <span className="inline-block w-2 h-2 rounded-full bg-slate-200 mr-1" />
          Disponibles: {available}
        </span>
      </div>
    </div>
  );
}
