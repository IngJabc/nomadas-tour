import { cn } from '@/lib/utils';

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export function Label({ children, className, required, htmlFor, ...props }: LabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider',
        className,
      )}
      {...props}
    >
      {children}
      {required && <span className="text-[#ef4444] ml-0.5">*</span>}
    </label>
  );
}
