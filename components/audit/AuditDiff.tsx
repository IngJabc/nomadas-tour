'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { formatDateTimeShort } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import type { AuditAction } from '@/types/audit';

const FIELD_LABELS: Record<string, string> = {
  route_id: 'Ruta',
  departure_time: 'Salida',
  capacity: 'Capacidad',
  vehicle_type: 'Vehículo',
  status: 'Estado',
  trip_id: 'Viaje',
  passenger_count: 'Pasajeros',
  seat_codes: 'Asientos',
  logo_url: 'Logo',
  primary_color: 'Color primario',
  secondary_color: 'Color secundario',
  accent_color: 'Color de acento',
  in_app: 'In-app',
  email: 'Email',
};

const PREF_CATEGORY_LABELS: Record<string, string> = {
  trip_assignments: 'Nuevos viajes',
  trip_schedule_changes: 'Cambios de horario',
  trip_status_updates: 'Estado del viaje',
  trip_cancellations: 'Cancelaciones',
  trip_reminders: 'Recordatorios',
  ops_digest: 'Resumen diario',
  occupancy_alerts: 'Alertas de ocupación',
};

const VEHICLE_LABELS: Record<string, string> = {
  bus: 'Autobús',
  kia: 'Kia',
};

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncate(value: string, max = 48): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function formatScalar(
  key: string,
  value: unknown,
  routeLabels?: Record<string, string>,
): ReactNode {
  if (value == null) return <span className="text-[var(--color-brand-muted)]">—</span>;

  if (key === 'departure_time' && typeof value === 'string') {
    try {
      return formatDateTimeShort(value);
    } catch {
      return truncate(value);
    }
  }

  if (key === 'vehicle_type' && typeof value === 'string') {
    return VEHICLE_LABELS[value] ?? value;
  }

  if (key === 'status' && typeof value === 'string') {
    const variant =
      value === 'cancelled'
        ? 'cancelled'
        : value === 'confirmed' || value === 'active'
          ? 'active'
          : 'inactive';
    return (
      <Badge variant={variant} size="sm">
        {value}
      </Badge>
    );
  }

  if (key === 'seat_codes' && Array.isArray(value)) {
    const codes = value.filter((v): v is string => typeof v === 'string');
    if (codes.length === 0) return '—';
    return (
      <span className="inline-flex flex-wrap gap-1">
        {codes.map((code) => (
          <span
            key={code}
            className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-[var(--color-brand-navy)]"
          >
            {code}
          </span>
        ))}
      </span>
    );
  }

  if (key === 'route_id' && typeof value === 'string') {
    const label = routeLabels?.[value];
    if (label) return label;
    return (
      <span className="font-mono text-[12px]" title={value}>
        {value.slice(0, 8)}…
      </span>
    );
  }

  if (
    (key === 'primary_color' ||
      key === 'secondary_color' ||
      key === 'accent_color') &&
    typeof value === 'string'
  ) {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className="inline-block h-4 w-4 rounded border border-black/10"
          style={{ backgroundColor: value }}
          aria-hidden
        />
        <span className="font-mono text-[12px]">{value}</span>
      </span>
    );
  }

  if (key === 'logo_url') {
    if (value == null || value === '') {
      return <span className="text-[var(--color-brand-muted)]">Sin logo</span>;
    }
    return <span className="text-[13px]">Logo actualizado</span>;
  }

  if (typeof value === 'boolean') {
    return value ? 'Sí' : 'No';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'string') {
    return truncate(value);
  }

  try {
    return truncate(JSON.stringify(value));
  } catch {
    return '—';
  }
}

function collectKeys(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  const keys = new Set<string>();
  if (before) Object.keys(before).forEach((k) => keys.add(k));
  if (after) Object.keys(after).forEach((k) => keys.add(k));
  return Array.from(keys);
}

interface AuditDiffProps {
  action: AuditAction | string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  routeLabels?: Record<string, string>;
  className?: string;
}

export function AuditDiff({
  action,
  before,
  after,
  routeLabels,
  className,
}: AuditDiffProps) {
  if (action === 'boarding.board' || action === 'boarding.unboard') {
    return null;
  }

  if (!before && !after) return null;

  // Notification preferences: nested category → channels
  if (action === 'notification_preferences.updated') {
    const cats = collectKeys(before, after);
    if (cats.length === 0) return null;

    return (
      <div className={cn('space-y-3', className)}>
        <p className="font-[family-name:var(--font-body)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-muted)]">
          Cambios
        </p>
        <ul className="space-y-3">
          {cats.map((cat) => {
            const b = before?.[cat] as Record<string, unknown> | undefined;
            const a = after?.[cat] as Record<string, unknown> | undefined;
            const channels = new Set([
              ...Object.keys(b ?? {}),
              ...Object.keys(a ?? {}),
            ]);
            return (
              <li key={cat} className="rounded-xl bg-slate-50 p-3">
                <p className="mb-2 text-[13px] font-semibold text-[var(--color-brand-navy)]">
                  {PREF_CATEGORY_LABELS[cat] ?? humanizeKey(cat)}
                </p>
                <div className="space-y-1.5">
                  {Array.from(channels).map((ch) => (
                    <div
                      key={ch}
                      className="flex flex-wrap items-center gap-2 text-[13px]"
                    >
                      <span className="min-w-[72px] text-[var(--color-brand-muted)]">
                        {FIELD_LABELS[ch] ?? humanizeKey(ch)}
                      </span>
                      <span>{formatScalar(ch, b?.[ch])}</span>
                      <span className="text-[var(--color-brand-muted)]">→</span>
                      <span>{formatScalar(ch, a?.[ch])}</span>
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const keys = collectKeys(before, after);
  if (keys.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      <p className="font-[family-name:var(--font-body)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-muted)]">
        Cambios
      </p>
      <ul className="space-y-2">
        {keys.map((key) => (
          <li
            key={key}
            className="flex flex-col gap-1 rounded-xl bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
          >
            <span className="min-w-[120px] shrink-0 text-[12px] font-semibold text-[var(--color-brand-muted)]">
              {FIELD_LABELS[key] ?? humanizeKey(key)}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-[var(--color-brand-navy)]">
              <span className="min-w-0 break-words">
                {formatScalar(key, before?.[key], routeLabels)}
              </span>
              <span className="text-[var(--color-brand-muted)]" aria-hidden>
                →
              </span>
              <span className="min-w-0 break-words">
                {formatScalar(key, after?.[key], routeLabels)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
