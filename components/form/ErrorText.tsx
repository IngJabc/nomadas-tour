import { cn } from '@/lib/utils';

interface ErrorTextProps {
  children: React.ReactNode;
  className?: string;
}

export function ErrorText({ children, className }: ErrorTextProps) {
  return (
    <p className={cn(
      'font-[family-name:var(--font-body)] font-normal text-[12px] text-[#ef4444]',
      className,
    )}>
      {children}
    </p>
  );
}
