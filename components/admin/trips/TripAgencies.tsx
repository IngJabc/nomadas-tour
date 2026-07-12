'use client';

import { Building2 } from 'lucide-react';

interface TripAgenciesProps {
  agencies: {
    id: string;
    name: string;
    reservation_count: number;
  }[];
}

export function TripAgencies({ agencies }: TripAgenciesProps) {
  if (!agencies.length) return null;

  const MAX_VISIBLE = 3;
  const visible = agencies.slice(0, MAX_VISIBLE);
  const remaining = agencies.length - MAX_VISIBLE;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Building2 className="w-3.5 h-3.5 text-[var(--color-brand-muted)] shrink-0" />
        <span className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">
          {agencies.length} {agencies.length === 1 ? 'agencia' : 'agencias'}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 ml-5">
        {visible.map((a) => (
          <span
            key={a.id}
            className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-navy)] leading-tight"
          >
            {a.name}
          </span>
        ))}
        {remaining > 0 && (
          <span className="font-[family-name:var(--font-body)] font-semibold text-[11px] text-[var(--color-brand-cyan)] leading-tight">
            +{remaining} más
          </span>
        )}
      </div>
    </div>
  );
}
