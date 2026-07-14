import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  borderLeft?: boolean;
  borderColor?: string;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    className,
    hover = false,
    borderLeft = false,
    borderColor,
    children,
    style,
    ...props
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]',
        hover &&
          'transition-all duration-200 hover:shadow-[0_6px_24px_rgba(0,212,255,0.12)] hover:-translate-y-0.5',
        borderLeft && 'border-l-4',
        className
      )}
      style={{
        ...(borderLeft && borderColor ? { borderLeftColor: borderColor } : {}),
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
});
