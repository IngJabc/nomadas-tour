import { cn } from '@/lib/utils';

interface HelperTextProps {
  children: React.ReactNode;
  className?: string;
}

export function HelperText({ children, className }: HelperTextProps) {
  return (
    <p className={cn(
      'font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)]',
      className,
    )}>
      {children}
    </p>
  );
}
