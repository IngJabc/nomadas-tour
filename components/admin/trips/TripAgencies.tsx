'use client';

import { Building2 } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';

interface TripAgenciesProps {
  agencies: {
    id: string;
    name: string;
    reservation_count: number;
  }[];
}

const MAX_VISIBLE = 2;

export function TripAgencies({ agencies }: TripAgenciesProps) {
  if (!agencies.length) return null;

  const visible = agencies.slice(0, MAX_VISIBLE);
  const remaining = agencies.slice(MAX_VISIBLE);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Building2 className="w-3.5 h-3.5 text-[var(--color-brand-muted)] shrink-0" />
        <span className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">
          {agencies.length} {agencies.length === 1 ? 'agencia' : 'agencias'}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 ml-6">
        {visible.map((a) => (
          <span
            key={a.id}
            className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-navy)] leading-tight"
          >
            {a.name}
          </span>
        ))}
        {remaining.length > 0 && (
          <Tooltip
            content={
              <div className="whitespace-normal max-h-40 overflow-y-auto">
                <span className="font-[family-name:var(--font-body)] font-semibold text-[11px] text-white/70 leading-tight block mb-1">
                  Agencias adicionales:
                </span>
                {remaining.map((a) => (
                  <span
                    key={a.id}
                    className="font-[family-name:var(--font-body)] font-normal text-[11px] text-white leading-tight block"
                  >
                    {'\u2022'} {a.name}
                  </span>
                ))}
              </div>
            }
          >
            <span className="font-[family-name:var(--font-body)] font-semibold text-[11px] text-[var(--color-brand-cyan)] leading-tight cursor-default">
              +{remaining.length} {remaining.length === 1 ? 'agencia más' : 'agencias más'}
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
