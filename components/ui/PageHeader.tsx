import Link from 'next/link';
import { cn } from '@/lib/utils';

interface Breadcrumb {
  label: string;
  href: string;
}

interface PageHeaderProps {
  title: string;
  breadcrumbs?: Breadcrumb[];
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, breadcrumbs, action, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <p className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.href}>
            <Link
              href={crumb.href}
              className="text-[var(--color-brand-cyan)] no-underline hover:underline"
            >
              {crumb.label}
            </Link>
            {i < breadcrumbs.length - 1 && <span> / </span>}
          </span>
        ))}
      </p>
      )}
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <h1 className="font-[family-name:var(--font-heading)] font-extrabold text-[22px] sm:text-2xl text-[var(--color-brand-navy)]">
          {title}
        </h1>
        {action && <div className="self-start sm:self-auto">{action}</div>}
      </div>
    </div>
  );
}
