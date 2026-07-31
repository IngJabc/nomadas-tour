'use client';

import { useState, useRef, useEffect, useMemo, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateShort } from '@/lib/timezone';
import { DayPickerCalendar } from '@/components/ui/day-picker-calendar';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function parseDate(value: string): Date | undefined {
  if (!value) return undefined;
  const match = value.match(DATE_RE);
  if (!match) return undefined;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Fecha',
  disabled = false,
  className,
}: DatePickerProps) {
  const pickerId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedDate = useMemo(() => parseDate(value), [value]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleSelect = (date: Date | undefined) => {
    if (!date || disabled) return;
    onChange(formatDate(date));
    setOpen(false);
  };

  const displayLabel = value
    ? formatDateShort(`${value}T12:00`)
    : placeholder;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        id={pickerId}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'w-full h-10 border-[1.5px] border-[#e5e7eb] rounded-xl pl-8 pr-8 text-base font-[family-name:var(--font-body)] font-normal bg-white outline-none transition-all duration-200 text-left',
          'focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]',
          value ? 'text-[var(--color-brand-navy)]' : 'text-[var(--color-brand-muted)]',
          disabled && 'opacity-40 cursor-not-allowed',
        )}
      >
        {displayLabel}
      </button>
      <Calendar
        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-brand-muted)] pointer-events-none"
        strokeWidth={1.75}
      />
      {value && !disabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange('');
            setOpen(false);
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] transition-colors duration-150"
          aria-label="Limpiar fecha"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-[calc(100%+8px)] z-50 w-[min(100vw-32px,340px)] rounded-2xl border border-[rgba(0,0,0,0.06)] bg-[var(--color-brand-surface)] p-4 shadow-[0_6px_24px_rgba(0,212,255,0.12)]"
          >
            <DayPickerCalendar
              size="comfortable"
              selected={selectedDate}
              onSelect={handleSelect}
              defaultMonth={selectedDate}
              disabled={disabled}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
