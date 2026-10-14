'use client';

import Link from 'next/link';
import {
  MapPin,
  Calendar,
  FileImage,
  ReceiptText,
  ChevronRight,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatDateTimeShort } from '@/lib/timezone';
import { formatSeatPriceCents } from '@/lib/price';
import {
  PAYMENT_STATUS_LABELS,
  paymentStatusBadgeVariant,
  type AgencyPaymentListItem,
} from '@/lib/payments';

export function AgencyPaymentCard({ payment }: { payment: AgencyPaymentListItem }) {
  const trip = payment.reservation.trip;

  return (
    <Link href={`/agency/payments/${payment.id}`} className="no-underline block group">
      <Card hover>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="font-[family-name:var(--font-heading)] font-bold text-[17px] text-[var(--color-brand-navy)] truncate">
              {payment.reservation.booker_name || 'Sin reservador'}
            </h3>
            <p className="font-[family-name:var(--font-body)] text-[12px] text-[var(--color-brand-muted)] mt-0.5">
              Enviado {formatDateTimeShort(payment.submitted_at)}
            </p>
          </div>
          <Badge variant={paymentStatusBadgeVariant(payment.status)} size="sm">
            {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
          </Badge>
        </div>

        {trip ? (
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2 text-[13px] text-[var(--color-brand-muted)]">
              <MapPin className="w-3.5 h-3.5 text-[var(--color-brand-cyan)] shrink-0" strokeWidth={1.75} />
              <span className="font-[family-name:var(--font-body)] truncate">
                {trip.origin} → {trip.destination}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[13px] text-[var(--color-brand-muted)]">
              <Calendar className="w-3.5 h-3.5 text-[var(--color-brand-cyan)] shrink-0" strokeWidth={1.75} />
              <span className="font-[family-name:var(--font-body)]">
                {formatDateTimeShort(trip.departure_time)}
              </span>
            </div>
          </div>
        ) : (
          <p className="font-[family-name:var(--font-body)] text-[13px] text-[var(--color-brand-muted)] mb-4">
            Sin viaje asociado
          </p>
        )}

        <div className="pt-4 border-t border-[rgba(0,0,0,0.06)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-[family-name:var(--font-heading)] font-extrabold text-base text-[var(--color-brand-navy)]">
              {formatSeatPriceCents(payment.amount_cents)}
            </span>
            {payment.has_proof && (
              <span className="inline-flex items-center gap-1 font-[family-name:var(--font-body)] text-[12px] text-[var(--color-brand-muted)]">
                <FileImage className="w-3.5 h-3.5" strokeWidth={1.75} />
                Comprobante
              </span>
            )}
            {payment.status === 'rejected' && payment.rejection_reason && (
              <span
                className="inline-flex items-center gap-1 font-[family-name:var(--font-body)] text-[12px] text-[#ef4444] truncate max-w-[180px]"
                title={payment.rejection_reason}
              >
                <ReceiptText className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                {payment.rejection_reason}
              </span>
            )}
          </div>
          <span className="inline-flex items-center gap-1 font-[family-name:var(--font-body)] text-[12px] font-medium text-[var(--color-brand-muted)] group-hover:text-[var(--color-brand-cyan)] transition-colors shrink-0">
            Ver detalle
            <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
          </span>
        </div>
      </Card>
    </Link>
  );
}
