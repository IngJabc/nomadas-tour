'use client';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

interface ListWidgetItem {
  id: string;
  label: string;
  subtitle?: string;
  badge?: React.ReactNode;
  onClick?: () => void;
}

interface ListWidgetProps {
  title: string;
  icon?: React.ReactNode;
  items: ListWidgetItem[];
  loading?: boolean;
  emptyIcon?: React.ReactNode;
  emptyMessage?: string;
  emptyAction?: { label: string; href?: string; onClick?: () => void };
}

export function ListWidget({
  title,
  icon,
  items,
  loading,
  emptyIcon,
  emptyMessage,
  emptyAction,
}: ListWidgetProps) {
  return (
    <Card className="p-5">
      <h3 className="font-[family-name:var(--font-body)] font-semibold text-[15px] text-[var(--color-brand-navy)] mb-4 flex items-center gap-2">
        {icon && <span className="text-[var(--color-brand-cyan)]">{icon}</span>}
        {title}
      </h3>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-3 w-3/4 mb-1" />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={emptyIcon || <div className="w-8 h-8" />}
          message={emptyMessage || 'Sin datos'}
          action={emptyAction}
        />
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-3 py-2.5 border-b border-[rgba(0,0,0,0.04)] last:border-0 ${item.onClick ? 'cursor-pointer hover:bg-slate-50 rounded-lg transition-colors' : ''}`}
              onClick={item.onClick}
            >
              <div className="flex-1 min-w-0">
                <p className="font-[family-name:var(--font-body)] font-semibold text-[13px] text-[var(--color-brand-navy)] truncate">
                  {item.label}
                </p>
                {item.subtitle && (
                  <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)]">
                    {item.subtitle}
                  </p>
                )}
              </div>
              {item.badge && <div className="shrink-0">{item.badge}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
