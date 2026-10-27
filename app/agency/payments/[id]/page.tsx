'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  AlertTriangle,
  CreditCard,
  FileImage,
  MapPin,
  Calendar,
  Bus,
  User,
  Phone,
  Mail,
  Users,
  CheckCircle2,
  XCircle,
  ReceiptText,
  ExternalLink,
  WifiOff,
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
import { PaymentProofViewerModal } from '@/components/agency/payments/PaymentProofViewerModal';
import { PaymentVerifyModal } from '@/components/agency/payments/PaymentVerifyModal';
import { PaymentRejectModal } from '@/components/agency/payments/PaymentRejectModal';
import {
  PAYMENT_STATUS_LABELS,
  paymentStatusBadgeVariant,
  type AgencyPaymentDetail,
} from '@/lib/payments';
import {
  subscribeToAgencyPaymentPassengers,
  subscribeToAgencyPaymentReservation,
  subscribeToAgencyPayments,
} from '@/lib/realtime/subscriptions';
import {
  useRealtimeRefresh,
  type RealtimeSubscribeFn,
} from '@/hooks/useRealtimeRefresh';
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

function TotalRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]">
        {label}
      </span>
      <span
        className={`font-[family-name:var(--font-heading)] font-bold text-sm ${
          highlight
            ? 'text-[var(--color-brand-cyan)]'
            : 'text-[var(--color-brand-navy)]'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default function PaymentDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [detail, setDetail] = useState<AgencyPaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  /** Última secuencia de carga: descarta respuestas viejas (RT-06). */
  const fetchSeqRef = useRef(0);

  const doFetch = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      setFetchError(null);
      const data = await agencyApi.getPayment(id);
      if (seq !== fetchSeqRef.current) return;
      setDetail(data);
    } catch (error) {
      if (seq !== fetchSeqRef.current) return;
      const notFound =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        (error as { status: number }).status === 404;
      setFetchError(
        notFound
          ? 'Este pago no existe o no pertenece a tu agencia.'
          : 'No se pudo cargar el pago. Intenta de nuevo.',
      );
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  // RT-06: el pago (estado/verificación/rechazo) más la reserva y sus
  // pasajeros, que alimentan el bloque de reserva, los badges y los
  // totales del DTO. Reserva/pasajeros solo cuando el detalle ya cargó
  // (reservation_id es UUID); sus eventos cubren cancelaciones que no
  // tocan `payments` (p. ej. T-1).
  const reservationId = detail?.reservation.id ?? '';
  const realtimeSubscriptions = useMemo<RealtimeSubscribeFn[]>(() => {
    const list: RealtimeSubscribeFn[] = [
      (onChange, onStatus) =>
        subscribeToAgencyPayments(onChange, { paymentId: id, onStatus }),
    ];
    if (isUuid(reservationId)) {
      list.push(
        (onChange, onStatus) =>
          subscribeToAgencyPaymentReservation(reservationId, onChange, onStatus),
        (onChange, onStatus) =>
          subscribeToAgencyPaymentPassengers(reservationId, onChange, onStatus),
      );
    }
    return list;
  }, [id, reservationId]);

  const { degraded, refreshNow } = useRealtimeRefresh({
    subscriptions: realtimeSubscriptions,
    refresh: doFetch,
  });

  const handleActionSuccess = () => {
    // La RPC ya confirmó el estado: refresco inmediato; si además llega el
    // evento Realtime de la misma transacción, el hook lo pliega (min-gap).
    refreshNow();
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
          title="Pago"
          breadcrumbs={[{ label: 'Pagos', href: '/agency/payments' }]}
        />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-[#ef4444] shrink-0" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
              {fetchError ?? 'No se pudo cargar el pago.'}
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
            Volver a pagos
          </Link>
        </div>
      </main>
    );
  }

  const { payment, reservation, trip, passengers, allocations, totals } = detail;
  const isPending = payment.status === 'pending';
  const hasReservationLink = isUuid(reservation.id);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-4">
        <Link
          href="/agency/payments"
          className="inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
          Volver a pagos
        </Link>
      </div>

      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25 }}
      >
        <PageHeader
          title={`Pago · ${formatSeatPriceCents(payment.amount_cents)}`}
          action={
            <Badge variant={paymentStatusBadgeVariant(payment.status)}>
              {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
            </Badge>
          }
        />
      </motion.div>

      {/* RT-06: Realtime caído → no aparentar que el detalle está actual. */}
      {degraded && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6 p-4 rounded-xl bg-[#fffbeb] border border-[#fde68a]"
        >
          <div className="flex items-center gap-2.5">
            <WifiOff className="w-4 h-4 text-[#92400e] shrink-0" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-sm text-[#92400e]">
              Sin actualizaciones en vivo. Los datos pueden estar desactualizados.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={refreshNow}>
            Actualizar
          </Button>
        </motion.div>
      )}

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        {/* Acciones principales + comprobante + reserva */}
        {(isPending || payment.has_proof || hasReservationLink) && (
          <motion.div variants={staggerItem} className="flex flex-wrap items-center gap-3">
            {isPending && (
              <>
                <Button onClick={() => setVerifyOpen(true)}>
                  <CheckCircle2 className="w-4 h-4" strokeWidth={1.75} />
                  Verificar pago
                </Button>
                <Button variant="destructive" onClick={() => setRejectOpen(true)}>
                  <XCircle className="w-4 h-4" strokeWidth={1.75} />
                  Rechazar pago
                </Button>
              </>
            )}
            {payment.has_proof && (
              <Button variant="secondary" onClick={() => setProofOpen(true)}>
                <FileImage className="w-4 h-4" strokeWidth={1.75} />
                Ver comprobante
              </Button>
            )}
            {hasReservationLink && (
              <Link
                href={`/agency/reservations/${reservation.id}`}
                className="inline-flex items-center gap-2 bg-slate-100 text-[var(--color-brand-navy)] hover:bg-slate-200 rounded-xl font-[family-name:var(--font-body)] font-semibold px-5 py-2.5 text-[14px] no-underline transition-all duration-200"
              >
                <ExternalLink className="w-4 h-4" strokeWidth={1.75} />
                Ver reserva
              </Link>
            )}
          </motion.div>
        )}

        {payment.status === 'rejected' && payment.rejection_reason && (
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
                {payment.rejection_reason}
              </p>
            </div>
          </motion.div>
        )}

        {/* Resumen de pago + totales */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <motion.div variants={staggerItem}>
            <Card>
              <SectionTitle>Resumen del pago</SectionTitle>
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                    <CreditCard className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                      Monto
                    </p>
                    <p className="font-[family-name:var(--font-heading)] font-extrabold text-xl text-[var(--color-brand-navy)]">
                      {formatSeatPriceCents(payment.amount_cents)}
                    </p>
                  </div>
                </div>
                <InfoRow
                  icon={<Calendar className="w-4 h-4" strokeWidth={1.75} />}
                  label="Enviado"
                  value={formatDateTimeShort(payment.submitted_at)}
                />
                {payment.verified_at && (
                  <InfoRow
                    icon={<CheckCircle2 className="w-4 h-4" strokeWidth={1.75} />}
                    label="Verificado"
                    value={formatDateTimeShort(payment.verified_at)}
                  />
                )}
                <InfoRow
                  icon={<User className="w-4 h-4" strokeWidth={1.75} />}
                  label="Reservador"
                  value={reservation.booker_name || '—'}
                  strong
                />
                {reservation.booker_phone && (
                  <InfoRow
                    icon={<Phone className="w-4 h-4" strokeWidth={1.75} />}
                    label="Teléfono"
                    value={reservation.booker_phone}
                  />
                )}
                {reservation.contact_email && (
                  <InfoRow
                    icon={<Mail className="w-4 h-4" strokeWidth={1.75} />}
                    label="Correo"
                    value={reservation.contact_email}
                  />
                )}
              </div>
            </Card>
          </motion.div>

          <motion.div variants={staggerItem}>
            <Card>
              <SectionTitle>Totales</SectionTitle>
              <div className="mt-4 space-y-3">
                <TotalRow
                  label="Pasajeros activos"
                  value={String(totals.active_passenger_count)}
                />
                <TotalRow
                  label="Esperado"
                  value={formatSeatPriceCents(totals.expected_cents)}
                />
                <TotalRow
                  label="Asignado"
                  value={formatSeatPriceCents(totals.allocated_cents)}
                />
                <div className="pt-3 border-t border-[rgba(0,0,0,0.06)]">
                  <TotalRow
                    label="Restante"
                    value={formatSeatPriceCents(totals.remaining_cents)}
                    highlight={totals.remaining_cents > 0}
                  />
                </div>
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
                {passengers.length} en la reserva
              </span>
            </div>
            {passengers.length === 0 ? (
              <p className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]">
                Esta reserva no tiene pasajeros registrados.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {passengers.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 p-4 rounded-xl bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="font-[family-name:var(--font-body)] text-sm font-medium text-[var(--color-brand-navy)] truncate">
                        {p.name}
                      </p>
                      <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                        {p.seat_code ?? 'Sin asiento'}
                        {p.unit_price != null &&
                          ` · ${formatSeatPriceCents(p.unit_price)}`}
                      </p>
                    </div>
                    <Badge variant={p.status === 'active' ? 'active' : 'cancelled'} size="sm">
                      {p.status === 'active' ? 'Activo' : 'Cancelado'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </motion.div>

        {/* Asignaciones */}
        {allocations.length > 0 && (
          <motion.div variants={staggerItem}>
            <Card>
              <SectionTitle>Asignaciones del pago</SectionTitle>
              <div className="mt-4 space-y-2">
                {allocations.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="inline-flex items-center justify-center min-w-[36px] h-6 px-2 rounded-md bg-[var(--color-brand-navy)] text-white font-[family-name:var(--font-body)] font-semibold text-xs">
                        {a.seat_code ?? '—'}
                      </span>
                      <span className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                        {formatDateTimeShort(a.created_at)}
                      </span>
                    </div>
                    <span className="font-[family-name:var(--font-heading)] font-bold text-sm text-[var(--color-brand-navy)]">
                      {formatSeatPriceCents(a.amount_cents)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}
      </motion.div>

      <PaymentProofViewerModal
        open={proofOpen}
        paymentId={payment.id}
        onClose={() => setProofOpen(false)}
      />
      <PaymentVerifyModal
        open={verifyOpen}
        paymentId={payment.id}
        amountCents={payment.amount_cents}
        onClose={() => setVerifyOpen(false)}
        onSuccess={handleActionSuccess}
      />
      <PaymentRejectModal
        open={rejectOpen}
        paymentId={payment.id}
        onClose={() => setRejectOpen(false)}
        onSuccess={handleActionSuccess}
      />
    </main>
  );
}
