import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Button } from './Button';

interface EmptyStateProps {
  icon: React.ReactNode;
  message: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  className?: string;
}

export function EmptyState({ icon, message, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'text-center py-16 bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]',
        className
      )}
    >
      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
        <div className="w-8 h-8 text-[var(--color-brand-muted)]">{icon}</div>
      </div>
      <p className="font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-muted)] mb-4">
        {message}
      </p>
      {action &&
        (action.href ? (
          <Link href={action.href}>
            <Button>{action.label}</Button>
          </Link>
        ) : (
          <Button onClick={action.onClick}>{action.label}</Button>
        ))}
    </div>
  );
}
