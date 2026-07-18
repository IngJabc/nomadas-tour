'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Badge } from '@/components/ui/Badge';
import { formatDateTimeShort, formatDateLong, formatTime12h } from '@/lib/timezone';
import { VEHICLE_LABELS, type ReservationTicketData } from '@/types/reservation';
import { RESERVATION_STATUS_STYLES } from '@/lib/constants/reservation-status';
import {
  MapPin,
  Calendar,
  Clock,
  Bus,
  User,
  CreditCard,
  Phone,
  Users,
} from 'lucide-react';
import { staggerContainer, staggerItem } from '@/lib/motion/variants';

interface ReservationDetailProps {
  reservation: ReservationTicketData;
}

export function ReservationDetail({ reservation }: ReservationDetailProps) {
  const trip = reservation.trip;
  const statusInfo =
    RESERVATION_STATUS_STYLES[reservation.status] ??
    RESERVATION_STATUS_STYLES.confirmed;

  const boardedCount = useMemo(
    () => reservation.passengers.filter((p) => p.boarded).length,
    [reservation.passengers]
  );
  const totalPassengers = reservation.passengers.length;
  const progressPercent =
    totalPassengers > 0 ? (boardedCount / totalPassengers) * 100 : 0;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-4"
    >
      {/* Left: Trip + Booker */}
      <motion.div variants={staggerItem} className="space-y-6">
        {/* Trip */}
        <Card>
          <SectionTitle>Viaje</SectionTitle>
          <div className="mt-4 space-y-4">
            {trip && (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                    <MapPin className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                      Ruta
                    </p>
                    <p className="font-[family-name:var(--font-heading)] font-bold text-sm text-[var(--color-brand-navy)] truncate">
                      {trip.origin} → {trip.destination}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                      Salida
                    </p>
                    <p className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)]">
                      {formatDateLong(trip.departure_time)}
                    </p>
                    <p className="font-[family-name:var(--font-body)] text-[12px] text-[var(--color-brand-muted)]">
                      {formatTime12h(trip.departure_time)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                    <Bus className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                      Vehículo
                    </p>
                    <p className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)]">
                      {VEHICLE_LABELS[trip.vehicle_type] ?? trip.vehicle_type}
                    </p>
                  </div>
                </div>
              </>
            )}

            {!trip && (
              <p className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]">
                Información del viaje no disponible
              </p>
            )}
          </div>
        </Card>

        {/* Booker */}
        <Card>
          <SectionTitle>Reservador</SectionTitle>
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                  Nombre
                </p>
                <p className="font-[family-name:var(--font-heading)] font-bold text-sm text-[var(--color-brand-navy)] truncate">
                  {reservation.booker_name}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                <CreditCard className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                  Documento
                </p>
                <p className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)]">
                  {reservation.booker_document}
                </p>
              </div>
            </div>

            {reservation.booker_phone && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                  <Phone className="w-4 h-4 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                    Teléfono
                  </p>
                  <p className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)]">
                    {reservation.booker_phone}
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </motion.div>

      {/* Right: Quick Info */}
      <motion.div variants={staggerItem}>
        <Card>
          <SectionTitle>Resumen</SectionTitle>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)] flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" strokeWidth={1.75} />
                Creada
              </span>
              <span className="font-[family-name:var(--font-body)] font-medium text-[var(--color-brand-navy)]">
                {formatDateTimeShort(reservation.created_at)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)] flex items-center gap-2">
                <Users className="w-3.5 h-3.5" strokeWidth={1.75} />
                Pasajeros
              </span>
              <span className="font-[family-name:var(--font-body)] font-medium text-[var(--color-brand-navy)]">
                {totalPassengers}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)] flex items-center gap-2">
                <Bus className="w-3.5 h-3.5" strokeWidth={1.75} />
                Asientos
              </span>
              <span className="font-[family-name:var(--font-body)] font-medium text-[var(--color-brand-navy)]">
                {reservation.passengers
                  .map((p) => p.seat_code)
                  .filter(Boolean)
                  .join(', ') || '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-[family-name:var(--font-body)] text-[var(--color-brand-muted)] flex items-center gap-2">
                <User className="w-3.5 h-3.5" strokeWidth={1.75} />
                Estado
              </span>
              <Badge variant={statusInfo.variant} size="sm">
                {statusInfo.label}
              </Badge>
            </div>

            {totalPassengers > 0 && (
              <div className="pt-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)]">
                    Abordaje
                  </span>
                  <span className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)]">
                    {boardedCount}/{totalPassengers}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-[#10b981]"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPercent}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
              </div>
            )}
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
