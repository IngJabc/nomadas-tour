'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages: (number | 'ellipsis')[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== 'ellipsis') {
      pages.push('ellipsis');
    }
  }

  return (
    <nav className="flex items-center justify-center gap-1" aria-label="Paginación">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-sm font-[family-name:var(--font-body)] font-semibold text-[var(--color-brand-muted)] hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Página anterior"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {pages.map((p, idx) =>
        p === 'ellipsis' ? (
          <span
            key={`e-${idx}`}
            className="inline-flex items-center justify-center w-9 h-9 text-sm font-[family-name:var(--font-body)] text-[var(--color-brand-muted)]"
          >
            ...
          </span>
        ) : (
          <button
            key={p}
            type="button"
            disabled={p === page}
            onClick={() => onChange(p)}
            className={cn(
              'inline-flex items-center justify-center w-9 h-9 rounded-xl text-sm font-[family-name:var(--font-body)] font-semibold transition-colors',
              p === page
                ? 'bg-[var(--color-brand-cyan)] text-white'
                : 'text-[var(--color-brand-muted)] hover:bg-slate-100',
            )}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-sm font-[family-name:var(--font-body)] font-semibold text-[var(--color-brand-muted)] hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Página siguiente"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </nav>
  );
}
