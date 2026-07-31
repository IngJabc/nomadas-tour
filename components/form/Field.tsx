import { Label } from './Label';
import { HelperText } from './HelperText';
import { ErrorText } from './ErrorText';

interface FieldProps {
  label: string;
  children: React.ReactNode;
  error?: string;
  helperText?: string;
  required?: boolean;
  htmlFor?: string;
}

export function Field({ label, children, error, helperText, required, htmlFor }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} required={required}>{label}</Label>
      {children}
      {(error || helperText) && (
        <div className="min-h-[18px]">
          {error && <ErrorText>{error}</ErrorText>}
          {helperText && !error && <HelperText>{helperText}</HelperText>}
        </div>
      )}
    </div>
  );
}
