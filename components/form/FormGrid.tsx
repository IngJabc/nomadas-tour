import { cn } from '@/lib/utils';

interface FormGridProps {
  children: React.ReactNode;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}

const colMap: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

export function FormGrid({ children, columns = 2, className }: FormGridProps) {
  return (
    <div className={cn('grid gap-3', colMap[columns], className)}>
      {children}
    </div>
  );
}
