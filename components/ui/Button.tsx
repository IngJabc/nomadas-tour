'use client';

import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Loader2, Check, X } from 'lucide-react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-[family-name:var(--font-body)] font-semibold border-none cursor-pointer transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--color-brand-cyan)] text-white hover:bg-[var(--color-brand-blue)]',
        secondary:
          'bg-slate-100 text-[var(--color-brand-navy)] hover:bg-slate-200',
        destructive:
          'bg-[#fef2f2] text-[#ef4444] hover:bg-[#fee2e2]',
        ghost:
          'bg-transparent text-[var(--color-brand-navy)] hover:bg-slate-100',
      },
      size: {
        sm: 'px-3 py-1.5 text-[12px]',
        md: 'px-5 py-2.5 text-[14px]',
        lg: 'px-6 py-3.5 text-[15px]',
      },
      feedback: {
        success: '',
        error: '',
      },
    },
    compoundVariants: [
      {
        variant: 'primary',
        feedback: 'success',
        className: 'bg-[#10b981] hover:bg-[#059669]',
      },
      {
        variant: 'primary',
        feedback: 'error',
        className: 'bg-[#ef4444] hover:bg-[#dc2626]',
      },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  feedback?: 'success' | 'error' | null;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, feedback, disabled, children, ...props }, ref) => {
    const showFeedback = feedback && !loading;

    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, feedback, className }))}
        disabled={disabled || loading || !!feedback}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {showFeedback && feedback === 'success' && <Check className="h-4 w-4" />}
        {showFeedback && feedback === 'error' && <X className="h-4 w-4" />}
        {!showFeedback && children}
        {showFeedback && (
          <span>{feedback === 'success' ? 'Hecho' : 'Error'}</span>
        )}
      </button>
    );
  }
);
Button.displayName = 'Button';
