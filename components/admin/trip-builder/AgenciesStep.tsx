'use client';

import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const inputClass =
  "w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-white outline-none transition-all duration-200 focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]";

interface AgenciesStepProps {
  agencies: { id: string; name: string; status?: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** When true, root and pills are centered horizontally */
  centered?: boolean;
  className?: string;
}

export function AgenciesStep({
  agencies,
  selectedIds,
  onChange,
  centered = false,
  className,
}: AgenciesStepProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () =>
      agencies.filter((a) =>
        a.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [agencies, search],
  );

  const activeAgencies = useMemo(
    () => filtered.filter((a) => a.status === 'active'),
    [filtered],
  );

  const toggleAgency = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  };

  if (agencies.length === 0) {
    return (
      <p
        className={cn(
          'font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]',
          centered && 'text-center',
        )}
      >
        No hay agencias disponibles. Crea una agencia primero.
      </p>
    );
  }

  if (activeAgencies.length === 0) {
    return (
      <p
        className={cn(
          'font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]',
          centered && 'text-center',
        )}
      >
        No hay agencias activas disponibles para asignar este viaje.
      </p>
    );
  }

  return (
    <div
      className={cn(
        'space-y-4 w-full max-w-lg',
        centered && 'mx-auto',
        className,
      )}
    >
      <div className="relative w-full">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-brand-muted)] pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar agencia..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} pl-10 pr-10`}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)]"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div
          className={cn(
            'flex flex-wrap gap-1.5',
            centered && 'justify-center',
          )}
        >
          {selectedIds.map((id) => {
            const agency = agencies.find((a) => a.id === id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 font-[family-name:var(--font-body)] font-semibold text-[11px] px-[10px] py-[3px] rounded-full bg-[rgba(0,212,255,0.1)] text-[var(--color-brand-cyan)]"
              >
                {agency?.name ?? id}
                <button
                  type="button"
                  onClick={() => toggleAgency(id)}
                  className="ml-0.5 text-[var(--color-brand-cyan)] hover:text-[var(--color-brand-blue)] border-none bg-transparent cursor-pointer p-0 leading-none"
                >
                  <X className="w-3 h-3" strokeWidth={2.5} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="border border-[rgba(0,0,0,0.06)] rounded-xl overflow-hidden max-h-[220px] sm:max-h-[260px] overflow-y-auto w-full text-left">
        {activeAgencies.length === 0 ? (
          <p className="px-4 py-3 font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)] text-center">
            No se encontraron agencias
          </p>
        ) : (
          activeAgencies.map((a) => {
            const isSelected = selectedIds.includes(a.id);
            return (
              <label
                key={a.id}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors font-[family-name:var(--font-body)] text-sm',
                  isSelected ? 'bg-[rgba(0,212,255,0.06)]' : 'hover:bg-slate-50',
                  'border-b border-[rgba(0,0,0,0.04)] last:border-b-0',
                )}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleAgency(a.id)}
                  className="shrink-0"
                  style={{ width: 16, height: 16, accentColor: 'var(--color-brand-cyan)' }}
                />
                <span
                  className={cn(
                    'flex-1',
                    isSelected
                      ? 'text-[var(--color-brand-navy)] font-semibold'
                      : 'text-[var(--color-brand-navy)]',
                  )}
                >
                  {a.name}
                </span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
