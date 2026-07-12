import { cn } from '@/lib/utils';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  trend?: string;
  trendDirection?: 'up' | 'down' | 'neutral';
  iconBg?: string;
  iconColor?: string;
  className?: string;
  loading?: boolean;
  onClick?: () => void;
}

export function StatCard({
  icon,
  label,
  value,
  trend,
  trendDirection,
  iconBg = 'bg-[rgba(0,212,255,0.1)]',
  iconColor = 'text-[var(--color-brand-cyan)]',
  className,
  loading,
  onClick,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'bg-[var(--color-brand-surface)] rounded-2xl p-4 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-[rgba(0,0,0,0.06)]',
        onClick && 'cursor-pointer transition-all duration-200 hover:shadow-[0_6px_24px_rgba(0,212,255,0.12)] hover:-translate-y-0.5',
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', iconBg)}>
          <div className={cn('w-5 h-5', iconColor)}>{icon}</div>
        </div>
        <p className="font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-muted)] uppercase tracking-wider">
          {label}
        </p>
      </div>
      <p className="font-[family-name:var(--font-heading)] font-extrabold text-4xl text-[var(--color-brand-navy)] leading-none">
        {loading ? <span className="animate-pulse">—</span> : value}
      </p>
      {trend && (
        <p
          className={cn(
            'mt-1 font-[family-name:var(--font-body)] font-normal text-xs',
            trendDirection === 'up' && 'text-[#10b981]',
            trendDirection === 'down' && 'text-[#ef4444]',
            !trendDirection && 'text-[var(--color-brand-muted)]'
          )}
        >
          {trend}
        </p>
      )}
    </div>
  );
}
