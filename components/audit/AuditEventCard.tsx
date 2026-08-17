'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { AuditEventDetail, type AuditRoleView } from '@/components/audit/AuditEventDetail';
import {
  getAuditActionConfig,
  getEntityLabel,
  ROLE_LABELS,
  shortId,
  TONE_STYLES,
} from '@/components/audit/audit-config';
import { formatDateTimeShort } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import type { AuditEventDTO } from '@/types/audit';

const expandVariants = {
  hidden: { height: 0, opacity: 0 },
  visible: {
    height: 'auto' as const,
    opacity: 1,
    transition: {
      height: { duration: 0.25, ease: 'easeOut' as const },
      opacity: { duration: 0.2, delay: 0.05 },
    },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: {
      height: { duration: 0.2, ease: 'easeOut' as const },
      opacity: { duration: 0.12 },
    },
  },
};

interface AuditEventCardProps {
  event: AuditEventDTO;
  role: AuditRoleView;
  agencyName?: string | null;
  agencyLabels?: Record<string, string>;
  routeLabels?: Record<string, string>;
  /** When set with onExpandedChange, expansion is controlled by the parent (accordion). */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Scroll the card into view when it opens (admin accordion). */
  scrollOnExpand?: boolean;
}

export function AuditEventCard({
  event,
  role,
  agencyName,
  agencyLabels,
  routeLabels,
  expanded: expandedProp,
  onExpandedChange,
  scrollOnExpand = false,
}: AuditEventCardProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false);
  const isControlled = typeof expandedProp === 'boolean';
  const expanded = isControlled ? expandedProp : uncontrolledExpanded;
  const reduceMotion = useReducedMotion();
  const detailId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const config = getAuditActionConfig(event.action);
  const Icon = config.icon;
  const tone = TONE_STYLES[config.tone];
  const summary = config.summarize(event);

  const setExpanded = (next: boolean) => {
    if (isControlled) onExpandedChange?.(next);
    else setUncontrolledExpanded(next);
  };

  useEffect(() => {
    if (!scrollOnExpand || !expanded) return;
    const node = cardRef.current;
    if (!node) return;
    // After layout settles so the open card top is the scroll target.
    const id = window.requestAnimationFrame(() => {
      node.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [expanded, scrollOnExpand, reduceMotion]);

  const resolvedAgency =
    (event.agency_id && agencyLabels?.[event.agency_id]) ||
    (role === 'agency' ? agencyName : null) ||
    (event.agency_id ? `Agencia ${shortId(event.agency_id)}` : null);

  const actorLabel = event.actor
    ? `${resolvedAgency ?? '—'} · ${ROLE_LABELS[event.actor.role]}`
    : ROLE_LABELS.system;

  const entityText = `${getEntityLabel(event.entity_type)} #${shortId(event.entity_id)}`;

  return (
    <Card
      ref={cardRef}
      borderLeft
      borderColor={tone.border}
      className="!p-4 sm:!p-5 scroll-mt-6"
      data-testid="audit-event-card"
    >
      <div className="flex gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            tone.iconBg,
            tone.iconColor,
          )}
          aria-hidden
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-[family-name:var(--font-body)] text-[15px] font-semibold text-[var(--color-brand-navy)]">
                {config.label}
              </h3>
              <p className="mt-0.5 text-[12px] text-[var(--color-brand-muted)]">
                <span>{actorLabel}</span>
                <span aria-hidden> · </span>
                <time
                  dateTime={event.occurred_at}
                  aria-label={formatDateTimeShort(event.occurred_at)}
                >
                  {formatDateTimeShort(event.occurred_at)}
                </time>
              </p>
            </div>
          </div>

          <p className="mt-2 text-[13px] text-[var(--color-brand-navy)]">{entityText}</p>
          {summary && (
            <p className="mt-1 text-[13px] text-[var(--color-brand-muted)]">{summary}</p>
          )}

          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1 rounded-lg border-none bg-transparent px-0 py-1 text-[13px] font-semibold text-[var(--color-brand-cyan)] hover:text-[var(--color-brand-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-cyan)]"
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Ocultar detalle' : 'Ver detalle'}
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform duration-200',
                expanded && 'rotate-180',
              )}
              aria-hidden
            />
          </button>

          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                key="detail"
                id={detailId}
                initial={reduceMotion ? false : 'hidden'}
                animate="visible"
                exit={reduceMotion ? undefined : 'exit'}
                variants={reduceMotion ? undefined : expandVariants}
                className="overflow-hidden"
              >
                <AuditEventDetail
                  event={event}
                  role={role}
                  agencyName={agencyName}
                  agencyLabels={agencyLabels}
                  routeLabels={routeLabels}
                  detailId={`${detailId}-panel`}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Card>
  );
}
