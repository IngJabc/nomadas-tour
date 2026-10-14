'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  AlertTriangle,
  ShoppingCart,
  FileImage,
  MapPin,
  Calendar,
  Bus,
  User,
  Phone,
  Users,
  CheckCircle2,
  XCircle,
  ReceiptText,
  Hash,
  Building2,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { agencyApi } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PaymentDetailSkeleton } from '@/components/ui/Skeleton';
import { formatDateTimeShort } from '@/lib/timezone';
import { formatSeatPriceCents } from '@/lib/price';
import { isUuid } from '@/lib/utils';
import { CheckoutAttemptProofViewerModal } from '@/components/agency/payments/CheckoutAttemptProofViewerModal';
import { CheckoutAttemptVerifyModal } from '@/components/agency/payments/CheckoutAttemptVerifyModal';
import { CheckoutAttemptRejectModal } from '@/components/agency/payments/CheckoutAttemptRejectModal';
import {
  CHECKOUT_ATTEMPT_STATUS_LABELS,
  checkoutAttemptStatusBadgeVariant,
  type AgencyCheckoutAttemptDetail,
} from '@/lib/payments';
import { pageFade, staggerContainer, staggerItem } from '@/lib/motion/variants';

const VEHICLE_LABELS: Record<string, string> = {
  bus: 'Autobús',
  kia: 'KIA',
};

function InfoRow({
  icon,
  label,
  value,
  strong,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
        <div className="w-4 h-4 text-[var(--color-brand-cyan)]">{icon}</div>
      </div>
      <div className="min-w-0">
        <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
          {label}
        </p>
        <p
          className={`text-sm text-[var(--color-brand-navy)] truncate ${
            strong
              ? 'font-[family-name:var(--font-heading)] font-bold'
              : 'font-[family-name:var(--font-body)] font-medium'
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

export default function CheckoutAttemptDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [detail, setDetail] = useState<AgencyCheckoutAttemptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFetch = useCallback(async () => {
    try {
      setFetchError(null);
      const data = await agencyApi.getCheckoutAttempt(id);
      setDetail(data);
    } catch (error) {
      const notFound =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        (error as { status: number }).status === 404;
      setFetchError(
        notFound
          ? 'Esta compra no existe o no pertenece a tu agencia.'
          : 'No se pudo cargar la compra. Intenta de nuevo.',
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleActionSuccess = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      doFetch();
    }, 400);
    setVerifyOpen(false);
    setRejectOpen(false);
  };

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PaymentDetailSkeleton />
      </main>
    );
  }

  if (fetchError || !detail) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader
          title="Compra"
          breadcrumbs={[{ label: 'Compras', href: '/agency/payments' }]}
        />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
              {fetchError ?? 'No se pudo cargar la compra.'}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={doFetch}>
            Reintentar
          </Button>
        </div>
        <div className="mt-6">
          <Link
            href="/agency/payments"
            className="inline-flex items-center gap-2 font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-cyan)] no-underline hover:underline"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
            Volver a compras
          </Link>
        </div>
      </main>
    );
  }

  const { attempt, trip, passengers } = detail;
  const canReview = attempt.status === 'pending_review';
  const hasReservationLink = isUuid(attempt.reservation_id);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-4">
        <Link
          href="/agency/payments"
          className="inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
          Volver a compras
        </Link>
      </div>

      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25 }}
      >
        <PageHeader
          title={`Compra · ${formatSeatPriceCents(attempt.amount_cents)}`}
          action={
            <Badge variant={checkoutAttemptStatusBadgeVariant(attempt.status)}>
              {CHECKOUT_ATTEMPT_STATUS_LABELS[attempt.status] ?? attempt.status}
            </Badge>
          }
        />
      </motion.div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        {/* Acciones principales */}
        {(canReview || attempt.has_proof || hasReservationLink) && (
          <motion.div variants={staggerItem} className="flex flex-wrap items-center gap-3">
            {canReview && (
              <>
                <Button onClick={() => setVerifyOpen(true)}>
                  <CheckCircle2 className="w-4 h-4" strokeWidth={1.75} />
                  Verificar compra
                </Button>
                <Button variant="destructive" onClick={() => setRejectOpen(true)}>
                  <XCircle className="w-4 h-4" strokeWidth={1.75} />
                  Rechazar compra
                </Button>
              </>
            )}
            {attempt.has_proof && (
              <Button variant="secondary" onClick={() => setProofOpen(true)}>
                <FileImage className="w-4 h-4" strokeWidth={1.75} />
                Ver comprobante
              </Button>
            )}
            {hasReservationLink && (
              <Link
                href={`/agency/reservations/${attempt.reservation_id}`}
                className="inline-flex items-center gap-2 bg-slate-100 text-[var(--color-brand-navy)] hover:bg-slate-200 rounded-xl font-[family-name:var(--font-body)] font-semibold px-5 py-2.5 text-[14px] no-underline transition-all duration-200"
              >
                <ExternalLink className="w-4 h-4" strokeWidth={1.75} />
                Ver reserva
              </Link>
            )}
          </motion.div>
        )}

        {/* Rechazo */}
        {attempt.status === 'rejected' && attempt.rejection_reason && (
          <motion.div
            variants={staggerItem}
            className="flex items-start gap-3 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
          >
            <ReceiptText className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5" strokeWidth={1.75} />
            <div>
              <p className="font-[family-name:var(--font-body)] font-semibold text-sm text-[#ef4444]">
                Motivo del rechazo
              </p>
              <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444] mt-0.5">
                {attempt.rejection_reason}
              </p>
            </div>
          </motion.div>
        )}

        {/* Resumen + conciliación */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <motion.div variants={staggerItem}>
            <Card>
              <SectionTitle>Resumen de la compra</SectionTitle>
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                    <ShoppingCart className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                      Monto
                    </p>
                    <p className="font-[family-name:var(--font-heading)] font-extrabold text-xl text-[var(--color-brand-navy)]">
                      {formatSeatPriceCents(attempt.amount_cents)}
                    </p>
                  </div>
                </div>
                <InfoRow
                  icon={<Calendar className="w-4 h-4" strokeWidth={1.75} />}
                  label="Creada"
                  value={formatDateTimeShort(attempt.created_at)}
                />
                {attempt.proof_submitted_at && (
                  <InfoRow
                    icon={<FileImage className="w-4 h-4" strokeWidth={1.75} />}
                    label="Comprobante enviado"
                    value={formatDateTimeShort(attempt.proof_submitted_at)}
                  />
                )}
                {attempt.verified_at && (
                  <InfoRow
                    icon={<CheckCircle2 className="w-4 h-4" strokeWidth={1.75} />}
                    label="Verificada"
                    value={formatDateTimeShort(attempt.verified_at)}
                  />
                )}
                <InfoRow
                  icon={<User className="w-4 h-4" strokeWidth={1.75} />}
                  label="Reservador"
                  value={detail.passengers[0]?.name ?? '—'}
                  strong
                />
              </div>
            </Card>
          </motion.div>

          <motion.div variants={staggerItem}>
            <Card>
              <SectionTitle>Conciliación del pago</SectionTitle>
              <div className="mt-4 space-y-4">
                <InfoRow
                  icon={<Hash className="w-4 h-4" strokeWidth={1.75} />}
                  label="Referencia"
                  value={attempt.payment_reference ?? '—'}
                  strong
                />
                <InfoRow
                  icon={<Building2 className="w-4 h-4" strokeWidth={1.75} />}
                  label="Banco de origen"
                  value={attempt.bank_origin ?? '—'}
                />
                <InfoRow
                  icon={<Clock className="w-4 h-4" strokeWidth={1.75} />}
                  label="Fecha y hora del pago"
                  value={
                    attempt.payment_datetime
                      ? formatDateTimeShort(attempt.payment_datetime)
                      : '—'
                  }
                />
                <InfoRow
                  icon={<Users className="w-4 h-4" strokeWidth={1.75} />}
                  label="Pasajeros"
                  value={String(attempt.passenger_count)}
                />
                <InfoRow
                  icon={<FileImage className="w-4 h-4" strokeWidth={1.75} />}
                  label="Comprobantes enviados"
                  value={`${attempt.proof_count} de 3`}
                />
                {canReview && (
                  <InfoRow
                    icon={<Clock className="w-4 h-4" strokeWidth={1.75} />}
                    label="Ventana de revisión vence"
                    value={formatDateTimeShort(attempt.expires_at)}
                  />
                )}
              </div>

              {trip && (
                <div className="mt-6 pt-4 border-t border-[rgba(0,0,0,0.06)]">
                  <SectionTitle>Viaje</SectionTitle>
                  <div className="mt-4 space-y-3">
                    <InfoRow
                      icon={<MapPin className="w-4 h-4" strokeWidth={1.75} />}
                      label="Ruta"
                      value={`${trip.origin} → ${trip.destination}`}
                      strong
                    />
                    <InfoRow
                      icon={<Calendar className="w-4 h-4" strokeWidth={1.75} />}
                      label="Salida"
                      value={formatDateTimeShort(trip.departure_time)}
                    />
                    <InfoRow
                      icon={<Bus className="w-4 h-4" strokeWidth={1.75} />}
                      label="Vehículo"
                      value={VEHICLE_LABELS[trip.vehicle_type] ?? trip.vehicle_type}
                    />
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        </div>

        {/* Pasajeros */}
        <motion.div variants={staggerItem}>
          <Card>
            <div className="flex items-center justify-between gap-3 mb-4">
              <SectionTitle>Pasajeros</SectionTitle>
              <span className="inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                <Users className="w-3.5 h-3.5" strokeWidth={1.75} />
                {passengers.length} en la compra
              </span>
            </div>
            {passengers.length === 0 ? (
              <p className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]">
                Esta compra no tiene pasajeros registrados.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {passengers.map((p) => (
                  <div
                    key={p.seat_id}
                    className="flex items-center justify-between gap-3 p-4 rounded-xl bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="font-[family-name:var(--font-body)] text-sm font-medium text-[var(--color-brand-navy)] truncate">
                        {p.name}
                      </p>
                      <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                        {p.seat_code ?? 'Sin asiento'}
                        {p.document && ` · ${p.document}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </motion.div>
      </motion.div>

      <CheckoutAttemptProofViewerModal
        open={proofOpen}
        attemptId={attempt.id}
        onClose={() => setProofOpen(false)}
      />
      <CheckoutAttemptVerifyModal
        open={verifyOpen}
        attemptId={attempt.id}
        amountCents={attempt.amount_cents}
        onClose={() => setVerifyOpen(false)}
        onSuccess={handleActionSuccess}
      />
      <CheckoutAttemptRejectModal
        open={rejectOpen}
        attemptId={attempt.id}
        onClose={() => setRejectOpen(false)}
        onSuccess={handleActionSuccess}
      />
    </main>
  );
}
