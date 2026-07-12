import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, id, leftIcon, rightIcon, ...props }, ref) => {
    const inputId = id || `input-${label.toLowerCase().replace(/\s+/g, '-')}`;

    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className="font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider"
        >
          {label}
        </label>
        <div className="relative">
          {leftIcon && (
            <div className="absolute top-1/2 -translate-y-1/2 left-3.5 text-[var(--color-brand-muted)] pointer-events-none">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-4 py-3',
              'font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)]',
              'bg-white outline-none transition-all duration-200',
              'focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]',
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              error && 'border-[#ef4444] focus:border-[#ef4444] focus:shadow-[0_0_0_3px_rgba(239,68,68,0.15)]',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute top-1/2 -translate-y-1/2 right-3.5 text-[var(--color-brand-muted)] pointer-events-none">
              {rightIcon}
            </div>
          )}
        </div>
        {helperText && !error && (
          <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)]">
            {helperText}
          </p>
        )}
        {error && (
          <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[#ef4444]">
            {error}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';
