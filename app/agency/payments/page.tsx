'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CreditCard, ShoppingCart, X } from 'lucide-react';
import { agencyApi } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { PaymentCardSkeleton } from '@/components/ui/Skeleton';
import { AgencyPaymentCard } from '@/components/agency/payments/AgencyPaymentCard';
import { AgencyCheckoutAttemptCard } from '@/components/agency/payments/AgencyCheckoutAttemptCard';
import {
  PAYMENT_STATUS_LABELS,
  CHECKOUT_ATTEMPT_STATUS_LABELS,
  type AgencyPaymentListItem,
  type AgencyPaymentStatusFilter,
  type AgencyCheckoutAttemptListItem,
  type AgencyCheckoutAttemptStatusFilter,
} from '@/lib/payments';
import { pageFade, staggerContainer, staggerItem } from '@/lib/motion/variants';

const PAGE_LIMIT = 20;

type ViewMode = 'payments' | 'attempts';

const STATUS_FILTERS: { value: AgencyPaymentStatusFilter | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'verified', label: 'Verificados' },
  { value: 'rejected', label: 'Rechazados' },
];

const ATTEMPT_STATUS_FILTERS: {
  value: AgencyCheckoutAttemptStatusFilter;
  label: string;
}[] = [
  { value: '', label: 'Todas' },
  { value: 'pending_review', label: 'En revisión' },
  { value: 'verified', label: 'Verificadas' },
  { value: 'rejected', label: 'Rechazadas' },
  { value: 'expired', label: 'Expiradas' },
];

export default function AgencyPaymentsPage() {
  // Pagos se conserva en el codigo pero ya no se expone en la UI: la vista
  // por defecto (y unica visible) es Compras (checkout attempts, MKT-007).
  const [viewMode, setViewMode] = useState<ViewMode>('attempts');
  const [payments, setPayments] = useState<AgencyPaymentListItem[]>([]);
  const [attempts, setAttempts] = useState<AgencyCheckoutAttemptListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AgencyPaymentStatusFilter | ''>('');
  const [attemptFilter, setAttemptFilter] =
    useState<AgencyCheckoutAttemptStatusFilter>('');

  const doFetch = useCallback(async () => {
    try {
      setFetchError(null);
      if (viewMode === 'attempts') {
        const data = await agencyApi.listCheckoutAttempts({
          status: attemptFilter || undefined,
          page,
          limit: PAGE_LIMIT,
        });
        setAttempts(data.attempts);
        setTotal(data.total);
      } else {
        const data = await agencyApi.listPayments({
          status: statusFilter || undefined,
          page,
          limit: PAGE_LIMIT,
        });
        setPayments(data.payments);
        setTotal(data.total);
      }
    } catch {
      setFetchError(
        viewMode === 'attempts'
          ? 'No se pudieron cargar las compras. Intenta de nuevo.'
          : 'No se pudieron cargar los pagos. Intenta de nuevo.',
      );
    } finally {
      setLoading(false);
    }
  }, [viewMode, statusFilter, attemptFilter, page]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  const handleStatusFilter = (value: AgencyPaymentStatusFilter | '') => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleAttemptFilter = (value: AgencyCheckoutAttemptStatusFilter) => {
    setAttemptFilter(value);
    setPage(1);
  };

  const handleViewModeChange = (mode: ViewMode) => {
    if (mode === viewMode) return;
    setViewMode(mode);
    setPage(1);
    setFetchError(null);
  };

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerItem}>
            <div className="flex items-center justify-between mb-6">
              <div className="h-7 w-28 bg-slate-200 rounded-lg animate-pulse" />
              <div className="h-9 w-32 bg-slate-200 rounded-xl animate-pulse" />
            </div>
          </motion.div>
          <motion.div variants={staggerItem}>
            <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl h-9 px-1 shrink-0 overflow-hidden">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-7 bg-slate-200 rounded-lg animate-pulse" style={{ width: i === 1 ? 56 : i === 2 ? 96 : i === 3 ? 88 : 84 }} />
              ))}
            </div>
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <motion.div key={i} variants={staggerItem}>
                <PaymentCardSkeleton />
              </motion.div>
            ))}
          </div>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25 }}
      >
        <PageHeader
          title="Compras"
          action={
            <Link
              href="/agency/reservations"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-[var(--color-brand-navy)] font-[family-name:var(--font-body)] font-semibold text-sm rounded-xl no-underline transition-colors duration-200 hover:bg-slate-200"
            >
              Ver reservas
            </Link>
          }
        />
      </motion.div>

      {/* Vista unica de Compras: el toggle Pagos/Compras se retiro de la UI
          (Pagos sigue disponible en el codigo pero oculto). */}

      {fetchError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">{fetchError}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={doFetch}>
            Reintentar
          </Button>
        </motion.div>
      )}

      {/* Filtros de estado */}
      <motion.div
        className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6"
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        {viewMode === 'payments' ? (
          <div className="flex items-center gap-1.5 bg-[var(--color-brand-surface)] rounded-xl h-9 px-1 border border-[rgba(0,0,0,0.06)] shrink-0 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {STATUS_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleStatusFilter(value)}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-[family-name:var(--font-body)] font-medium transition-colors shrink-0 ${
                  statusFilter === value
                    ? 'bg-[var(--color-brand-cyan)] text-white'
                    : 'text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-[var(--color-brand-surface)] rounded-xl h-9 px-1 border border-[rgba(0,0,0,0.06)] shrink-0 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {ATTEMPT_STATUS_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleAttemptFilter(value)}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-[family-name:var(--font-body)] font-medium transition-colors shrink-0 ${
                  attemptFilter === value
                    ? 'bg-[var(--color-brand-cyan)] text-white'
                    : 'text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <AnimatePresence>
          {((viewMode === 'payments' && statusFilter) ||
            (viewMode === 'attempts' && attemptFilter)) && (
            <motion.button
              initial={{ opacity: 0, width: 0, scaleX: 0 }}
              animate={{ opacity: 1, width: 'auto', scaleX: 1 }}
              exit={{ opacity: 0, width: 0, scaleX: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              type="button"
              onClick={() =>
                viewMode === 'payments' ? handleStatusFilter('') : handleAttemptFilter('')
              }
              className="shrink-0 h-9 px-3 rounded-xl border border-[1.5px] border-[#e5e7eb] bg-white text-[var(--color-brand-muted)] hover:text-[#ef4444] hover:border-[#ef4444] transition-colors duration-150 flex items-center gap-1.5 text-xs font-[family-name:var(--font-body)] font-medium overflow-hidden origin-left"
            >
              <X className="w-3.5 h-3.5" />
              Limpiar
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Contenido */}
      {viewMode === 'payments' ? (
        payments.length === 0 ? (
          <EmptyState
            icon={<CreditCard className="w-8 h-8" />}
            message={
              statusFilter
                ? `No hay pagos ${PAYMENT_STATUS_LABELS[statusFilter]?.toLowerCase() ?? ''}`
                : 'Aún no hay pagos de marketplace'
            }
            action={
              statusFilter
                ? { label: 'Ver todos', onClick: () => handleStatusFilter('') }
                : { label: 'Ver reservas', href: '/agency/reservations' }
            }
          />
        ) : (
          <>
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {payments.map((p) => (
                <motion.div key={p.id} variants={staggerItem}>
                  <AgencyPaymentCard payment={p} />
                </motion.div>
              ))}
            </motion.div>

            <div className="mt-8">
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={setPage}
              />
            </div>
          </>
        )
      ) : attempts.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="w-8 h-8" />}
          message={
            attemptFilter
              ? `No hay compras ${CHECKOUT_ATTEMPT_STATUS_LABELS[attemptFilter]?.toLowerCase() ?? ''}`
              : 'Aún no hay compras de marketplace'
          }
          action={
            attemptFilter
              ? { label: 'Ver todas', onClick: () => handleAttemptFilter('') }
              : { label: 'Ver reservas', href: '/agency/reservations' }
          }
        />
      ) : (
        <>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {attempts.map((a) => (
              <motion.div key={a.id} variants={staggerItem}>
                <AgencyCheckoutAttemptCard attempt={a} />
              </motion.div>
            ))}
          </motion.div>

          <div className="mt-8">
            <Pagination
              page={page}
              totalPages={totalPages}
              onChange={setPage}
            />
          </div>
        </>
      )}
    </main>
  );
}
