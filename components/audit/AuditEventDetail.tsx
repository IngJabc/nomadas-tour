'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { AuditDiff } from '@/components/audit/AuditDiff';
import { AuditMetadata } from '@/components/audit/AuditMetadata';
import {
  getAuditActionConfig,
  getEntityLabel,
  ROLE_LABELS,
  shortId,
} from '@/components/audit/audit-config';
import { formatDateTimeShort } from '@/lib/timezone';
import type { AuditEventDTO } from '@/types/audit';

export type AuditRoleView = 'superadmin' | 'agency';

function deepLinks(
  event: AuditEventDTO,
  role: AuditRoleView,
): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = [];
  const id = event.entity_id;
  const agencyId = event.agency_id;

  if (role === 'superadmin') {
    if (event.entity_type === 'trip' && id) {
      links.push({ href: `/admin/trips/${id}`, label: 'Ver viaje' });
    }
    if (event.entity_type === 'reservation' && id) {
      links.push({ href: `/admin/bookings/${id}`, label: 'Ver reserva' });
    }
    if (
      (event.entity_type === 'agency_settings' ||
        event.entity_type === 'notification_preferences') &&
      agencyId
    ) {
      links.push({ href: `/admin/agencies/${agencyId}`, label: 'Ver agencia' });
    }
  } else {
    if (event.entity_type === 'trip' && id) {
      links.push({
        href: `/agency/trips/${id}/passengers`,
        label: 'Ver pasajeros',
      });
    }
    if (event.entity_type === 'reservation' && id) {
      links.push({
        href: `/agency/reservations/${id}`,
        label: 'Ver reserva',
      });
    }
    if (event.entity_type === 'agency_settings') {
      links.push({
        href: '/agency/settings/branding',
        label: 'Ver branding',
      });
    }
    if (event.entity_type === 'notification_preferences') {
      links.push({
        href: '/agency/settings/notifications',
        label: 'Ver notificaciones',
      });
    }
  }

  return links;
}

function CopyableId({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [value]);

  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-muted)]">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-[var(--color-brand-navy)]">
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-none bg-white text-[var(--color-brand-muted)] shadow-sm hover:text-[var(--color-brand-navy)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-brand-cyan)]"
          aria-label={`Copiar ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

interface AuditEventDetailProps {
  event: AuditEventDTO;
  role: AuditRoleView;
  agencyName?: string | null;
  agencyLabels?: Record<string, string>;
  routeLabels?: Record<string, string>;
  detailId: string;
}

export function AuditEventDetail({
  event,
  role,
  agencyName,
  agencyLabels,
  routeLabels,
  detailId,
}: AuditEventDetailProps) {
  const config = getAuditActionConfig(event.action);
  const links = deepLinks(event, role);

  const resolvedAgency =
    (event.agency_id && agencyLabels?.[event.agency_id]) ||
    (role === 'agency' ? agencyName : null) ||
    (event.agency_id ? `Agencia ${shortId(event.agency_id)}` : null);

  const actorLine = event.actor
    ? `${resolvedAgency ?? '—'} · ${ROLE_LABELS[event.actor.role]}`
    : ROLE_LABELS.system;

  return (
    <div
      id={detailId}
      className="mt-4 space-y-4 border-t border-[rgba(0,0,0,0.06)] pt-4"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-muted)]">
            Fecha
          </p>
          <p
            className="mt-1 text-[13px] text-[var(--color-brand-navy)]"
            aria-label={formatDateTimeShort(event.occurred_at)}
          >
            {formatDateTimeShort(event.occurred_at)}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--color-brand-muted)]">
            UTC {event.occurred_at}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-muted)]">
            Actor
          </p>
          <p className="mt-1 text-[13px] text-[var(--color-brand-navy)]">{actorLine}</p>
          <p className="mt-1 text-[11px] text-[var(--color-brand-muted)]">
            Identificación nominal del actor: evolución futura.
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <CopyableId label="ID evento" value={event.id} />
        {event.actor?.user_id ? (
          <CopyableId label="Usuario técnico" value={event.actor.user_id} />
        ) : (
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-muted)]">
              Usuario técnico
            </p>
            <p className="mt-1 text-[13px] text-[var(--color-brand-muted)]">Sistema</p>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-slate-50 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-muted)]">
          Entidad
        </p>
        <p className="mt-1 text-[13px] text-[var(--color-brand-navy)]">
          {getEntityLabel(event.entity_type)}
          {event.entity_id ? ` · ${event.entity_id}` : ''}
        </p>
      </div>

      <AuditDiff
        action={event.action}
        before={event.before}
        after={event.after}
        routeLabels={routeLabels}
      />

      <AuditMetadata metadata={event.metadata} />

      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-cyan-bg)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-brand-cyan)] no-underline hover:bg-[rgba(0,212,255,0.2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-brand-cyan)]"
            >
              {link.label}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ))}
        </div>
      )}

      {(event.action === 'boarding.board' ||
        event.action === 'boarding.unboard') && (
        <p className="text-[12px] text-[var(--color-brand-muted)]">
          Sin deep-link de abordaje en esta versión. Usa asiento y IDs técnicos
          para correlacionar.
        </p>
      )}

      <p className="text-[11px] text-[var(--color-brand-muted)]">
        {config.label} · {event.action}
      </p>
    </div>
  );
}
