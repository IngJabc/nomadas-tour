import { cn } from '@/lib/utils';

interface SectionTitleProps {
  children: React.ReactNode;
  className?: string;
  as?: 'h1' | 'h2' | 'h3';
}

export function SectionTitle({ children, className, as: Tag = 'h2' }: SectionTitleProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="w-1 h-[18px] bg-[var(--color-brand-cyan)] rounded-sm shrink-0" />
      <Tag
        className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]"
      >
        {children}
      </Tag>
    </div>
  );
}
