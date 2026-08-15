'use client';

import { cn } from '@/lib/utils';

const META_LABELS: Record<string, string> = {
  source: 'Origen',
  ip: 'IP',
  user_agent: 'User-Agent',
  seat_code: 'Asiento',
  freed_seat_count: 'Asientos liberados',
};

const ALLOWED_KEYS = new Set(Object.keys(META_LABELS));

const FORBIDDEN = new Set([
  'authorization',
  'cookie',
  'cookies',
  'token',
  'password',
  'qr_code',
  'ticket_code',
  'name',
  'document',
  'phone',
  'email',
  'contact_email',
]);

interface AuditMetadataProps {
  metadata: Record<string, unknown> | null | undefined;
  className?: string;
}

export function AuditMetadata({ metadata, className }: AuditMetadataProps) {
  if (!metadata || typeof metadata !== 'object') return null;

  const entries = Object.entries(metadata).filter(([key]) => {
    const lower = key.toLowerCase();
    if (FORBIDDEN.has(lower)) return false;
    return ALLOWED_KEYS.has(key);
  });

  if (entries.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      <p className="font-[family-name:var(--font-body)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-muted)]">
        Contexto
      </p>
      <dl className="grid gap-2 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-muted)]">
              {META_LABELS[key] ?? key}
            </dt>
            <dd className="mt-0.5 break-words font-[family-name:var(--font-body)] text-[13px] text-[var(--color-brand-navy)]">
              {value == null
                ? '—'
                : typeof value === 'string' || typeof value === 'number'
                  ? String(value)
                  : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
