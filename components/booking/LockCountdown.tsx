'use client';

import { Clock, AlertTriangle } from 'lucide-react';

interface LockCountdownProps {
  seconds: number | null;
  formattedTime: string | null;
}

export function LockCountdown({ seconds, formattedTime }: LockCountdownProps) {
  if (seconds === null || formattedTime === null) return null;

  const isUrgent = seconds <= 60;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors duration-200 ${
        isUrgent
          ? 'bg-[#fffbeb] border-[#fde68a]'
          : 'bg-[rgba(0,212,255,0.04)] border-[rgba(0,212,255,0.15)]'
      }`}
    >
      {isUrgent ? (
        <AlertTriangle className="w-4 h-4 text-[#f59e0b] shrink-0" strokeWidth={1.75} />
      ) : (
        <Clock className="w-4 h-4 text-[var(--color-brand-cyan)] shrink-0" strokeWidth={1.75} />
      )}
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider whitespace-nowrap">
          Tiempo restante
        </span>
        <span
          className={`font-[family-name:var(--font-heading)] font-bold text-sm tabular-nums ${
            isUrgent ? 'text-[#f59e0b]' : 'text-[var(--color-brand-navy)]'
          }`}
        >
          {formattedTime}
        </span>
      </div>
    </div>
  );
}
