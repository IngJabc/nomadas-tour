import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center font-[family-name:var(--font-body)] font-semibold rounded-full px-[10px] py-[3px]',
  {
    variants: {
      variant: {
        active: 'bg-[#ecfdf5] text-[#059669]',
        inactive: 'bg-[#f1f5f9] text-[var(--color-brand-muted)]',
        cancelled: 'bg-[#fef2f2] text-[#ef4444]',
        warning: 'bg-[#fffbeb] text-[#92400e]',
        info: 'bg-[rgba(0,212,255,0.1)] text-[var(--color-brand-cyan)]',
        boarded: 'bg-blue-50 text-blue-600',
        confirmed: 'bg-emerald-50 text-emerald-600',
        completed: 'bg-[#f1f5f9] text-[var(--color-brand-muted)]',
        count: 'bg-[var(--color-brand-cyan)] text-white font-bold min-w-[16px] h-4 justify-center',
        danger: 'bg-[var(--color-danger)] text-white font-bold min-w-[16px] h-4 justify-center',
      },
      size: {
        xs: 'text-[9px] px-1.5 py-0.5',
        sm: 'text-[10px] px-2 py-0.5',
        md: 'text-[11px] px-[10px] py-[3px]',
      },
    },
    defaultVariants: {
      variant: 'inactive',
      size: 'md',
    },
  }
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size, className }))} {...props} />
  );
}
