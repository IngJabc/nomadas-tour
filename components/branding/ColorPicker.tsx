'use client';

import { cn } from '@/lib/utils';
import { HEX_COLOR_PATTERN } from '@/lib/brand/utils';

interface ColorPickerProps {
  id: string;
  label: string;
  value: string;
  description: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

export function ColorPicker({
  id,
  label,
  value,
  description,
  onChange,
  error,
  disabled = false,
}: ColorPickerProps) {
  const nativeColorValue = HEX_COLOR_PATTERN.test(value) ? value : '#000000';

  return (
    <div className="space-y-2">
      <div>
        <label
          htmlFor={`${id}-hex`}
          className="font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider"
        >
          {label}
        </label>
        <p className="mt-1 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
          {description}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label
          htmlFor={`${id}-picker`}
          className="sr-only"
        >
          Seleccionar {label.toLowerCase()}
        </label>
        <input
          id={`${id}-picker`}
          type="color"
          value={nativeColorValue}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="w-12 h-12 shrink-0 rounded-xl border-[1.5px] border-[#e5e7eb] bg-white p-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <input
          id={`${id}-hex`}
          type="text"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#000000"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(
            'w-full min-w-0 border-[1.5px] rounded-xl px-4 py-3 bg-white outline-none transition-all duration-200',
            'font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] uppercase',
            'focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]',
            error ? 'border-[#ef4444]' : 'border-[#e5e7eb]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        />
      </div>

      {error && (
        <p
          id={`${id}-error`}
          className="font-[family-name:var(--font-body)] text-xs text-[#ef4444]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
