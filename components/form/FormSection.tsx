import { cn } from '@/lib/utils';

interface FormSectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {title && (
        <div className="flex items-center gap-3 mb-1">
          <div className="w-1 h-[18px] bg-[var(--color-brand-cyan)] rounded-sm" />
          <h3 className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]">
            {title}
          </h3>
        </div>
      )}
      {description && (
        <p className="font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-muted)] -mt-2 mb-1">
          {description}
        </p>
      )}
      {children}
    </div>
  );
}
