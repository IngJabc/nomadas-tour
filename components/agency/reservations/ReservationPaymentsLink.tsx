'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { CreditCard, ChevronDown, AlertTriangle } from 'lucide-react';
import { agencyApi } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { formatSeatPriceCents } from '@/lib/price';
import { isUuid } from '@/lib/utils';
import {
  PAYMENT_STATUS_LABELS,
  paymentStatusBadgeVariant,
  type AgencyPaymentListItem,
} from '@/lib/payments';

/**
 * Límite de páginas a recorrer al buscar pagos de una reserva.
 * listPayments no acepta filtro por reservation_id, por lo que se
 * paginan todas las páginas (limit=50) y se filtra por reservation.id
 * en el cliente. El tope evita bucles indefinidos.
 */
const MAX_PAGES = 20;
const PAGE_LIMIT = 50;
const MAX_SEARCHABLE_PAYMENTS = MAX_PAGES * PAGE_LIMIT; // 1 000

interface FetchOutcome {
  payments: AgencyPaymentListItem[];
  truncated: boolean;
}

async function fetchPaymentsForReservation(
  reservationId: string,
): Promise<FetchOutcome> {
  const matched: AgencyPaymentListItem[] = [];
  let page = 1;

  while (page <= MAX_PAGES) {
    const result = await agencyApi.listPayments({ page, limit: PAGE_LIMIT });
    matched.push(
      ...result.payments.filter((p) => p.reservation?.id === reservationId),
    );
    // total puede cambiar entre páginas. Solo confiar en él para detectar el
    // final si es consistente con lo ya recibido; un total que contradice los
    // datos no debe declarar resultados completos. MAX_PAGES protege el bucle.
    const fetchedSoFar = (page - 1) * PAGE_LIMIT + result.payments.length;
    const totalPlausible = result.total >= fetchedSoFar;
    const reachedEnd =
      result.payments.length === 0 ||
      (page * PAGE_LIMIT >= result.total && totalPlausible);
    if (reachedEnd) {
      return { payments: matched, truncated: false };
    }
    page += 1;
  }

  // Se cortó en MAX_PAGES sin poder demostrar que se llegó al final.
  return { payments: matched, truncated: true };
}

interface ReservationPaymentsLinkProps {
  reservationId: string;
}

export function ReservationPaymentsLink({
  reservationId,
}: ReservationPaymentsLinkProps) {
  const [payments, setPayments] = useState<AgencyPaymentListItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPaymentsForReservation(reservationId)
      .then((result) => {
        if (!cancelled) {
          setPayments(result.payments);
          setTruncated(result.truncated);
        }
      })
      .catch((error) => {
        // No incluir tokens, cookies ni datos personales en el log.
        console.error(
          '[ReservationPaymentsLink] No se pudieron cargar los pagos:',
          error,
        );
        if (!cancelled) setFetchError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reservationId]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (loading) return null;

  // Error de consulta: no presentar como «cero pagos».
  if (fetchError) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 bg-[#fffbeb] border border-[#fde68a] text-[#92400e] rounded-xl font-[family-name:var(--font-body)] font-medium px-3 py-1.5 text-[12px]"
      >
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
        No se pudieron cargar los pagos
      </span>
    );
  }

  const validPayments = payments.filter((p) => isUuid(p.id));

  // El detalle de compra (checkout attempt) es la vista principal de revision.
  // Los pagos creados por MKT-007 traen su intento; los del flujo legacy
  // siguen enlazando al detalle de pago.
  const hrefFor = (payment: AgencyPaymentListItem) =>
    payment.checkout_attempt_id && isUuid(payment.checkout_attempt_id)
      ? `/agency/payments/attempts/${payment.checkout_attempt_id}`
      : `/agency/payments/${payment.id}`;

  const truncatedNotice = truncated ? (
    <span
      role="status"
      title={`Resultados limitados a ${MAX_SEARCHABLE_PAYMENTS.toLocaleString('es-VE')} pagos. Consulta la lista de pagos para continuar`}
      className="inline-flex items-center gap-1 text-[#92400e] text-[11px] font-[family-name:var(--font-body)] whitespace-nowrap"
    >
      <AlertTriangle className="w-3 h-3 shrink-0" strokeWidth={1.75} />
      Resultados limitados
    </span>
  ) : null;

  if (validPayments.length === 0) {
    return truncatedNotice;
  }

  if (validPayments.length === 1) {
    const payment = validPayments[0];
    return (
      <span className="inline-flex items-center gap-2">
        <Link
          href={hrefFor(payment)}
          className="inline-flex items-center gap-2 bg-slate-100 text-[var(--color-brand-navy)] hover:bg-slate-200 rounded-xl font-[family-name:var(--font-body)] font-semibold px-3 py-1.5 text-[12px] no-underline transition-all duration-200"
        >
          <CreditCard className="w-4 h-4" strokeWidth={1.75} />
          Ver pago
        </Link>
        {truncatedNotice}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="true"
          className="inline-flex items-center gap-2 bg-slate-100 text-[var(--color-brand-navy)] hover:bg-slate-200 rounded-xl font-[family-name:var(--font-body)] font-semibold px-3 py-1.5 text-[12px] cursor-pointer border-none transition-all duration-200"
        >
          <CreditCard className="w-4 h-4" strokeWidth={1.75} />
          Pagos ({validPayments.length})
          <ChevronDown className="w-3 h-3" strokeWidth={1.75} />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              role="menu"
              className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl border border-[rgba(0,0,0,0.06)] shadow-[0_6px_24px_rgba(0,0,0,0.08)] z-50 overflow-hidden"
            >
              <div className="max-h-64 overflow-y-auto">
                {validPayments.map((payment) => (
                  <Link
                    key={payment.id}
                    href={hrefFor(payment)}
                    onClick={() => setOpen(false)}
                    role="menuitem"
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition-colors no-underline border-b border-[rgba(0,0,0,0.04)] last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="font-[family-name:var(--font-body)] text-sm font-medium text-[var(--color-brand-navy)]">
                        {formatSeatPriceCents(payment.amount_cents)}
                      </p>
                      <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)] truncate">
                        {payment.reservation?.booker_name || '—'}
                      </p>
                    </div>
                    <Badge
                      variant={paymentStatusBadgeVariant(payment.status)}
                      size="sm"
                    >
                      {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                    </Badge>
                  </Link>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {truncatedNotice}
    </span>
  );
}
