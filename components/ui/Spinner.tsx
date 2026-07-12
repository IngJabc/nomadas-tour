import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  size?: number;
  className?: string;
  text?: string;
}

export function Spinner({ size = 20, className, text }: SpinnerProps) {
  return (
    <div className={cn('flex items-center justify-center gap-3', className)}>
      <Loader2
        className="animate-spin"
        style={{ width: size, height: size }}
      />
      {text && (
        <span className="font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-muted)]">
          {text}
        </span>
      )}
    </div>
  );
}
