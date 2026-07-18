"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Bus,
  MapPin,
  Calendar,
  Clock,
  ArrowLeft,
} from "lucide-react";
import { QRCode } from "react-qr-code";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { adminApi } from "@/lib/api";
import { pageFade, staggerContainer, staggerItem } from "@/lib/motion/variants";

type Passenger = {
  id: string;
  name: string;
  document: string;
  seat_id: string;
  boarded: boolean;
  seats: { seat_code: string } | null;
};

type ReservationDetail = {
  id: string;
  qr_code: string;
  status: string;
  created_at: string;
  booker_name: string;
  booker_document: string;
  agencies: { id: string; name: string } | null;
  trips: {
    id: string;
    departure_time: string;
    status: string;
    routes: {
      origin: string;
      destination: string;
    } | null;
  } | null;
  reservation_passengers: Passenger[] | null;
};

const STATUS_BADGE: Record<
  string,
  { label: string; variant: "confirmed" | "cancelled" | "boarded" | "inactive" }
> = {
  confirmed: { label: "Confirmada", variant: "confirmed" },
  cancelled: { label: "Cancelada", variant: "cancelled" },
  boarded: { label: "Abordado", variant: "boarded" },
};

const TRIP_STATUS: Record<
  string,
  { label: string; variant: "active" | "completed" | "cancelled" | "warning" }
> = {
  active: { label: "Activo", variant: "active" },
  completed: { label: "Completado", variant: "completed" },
  cancelled: { label: "Cancelado", variant: "cancelled" },
  postponed: { label: "Pospuesto", variant: "warning" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${formatDate(iso)} - ${formatTime(iso)}`;
}

export default function BookingDetailPage() {
  const params = useParams();
  const bookingId = params.bookingId as string;

  const [reservation, setReservation] = useState<ReservationDetail | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReservation = async () => {
      try {
        const data = await adminApi.getReservation(bookingId);
        setReservation(data as ReservationDetail);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al cargar");
      } finally {
        setLoading(false);
      }
    };
    fetchReservation();
  }, [bookingId]);

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={staggerItem}>
            <CardSkeleton />
          </motion.div>
        </motion.div>
      </main>
    );
  }

  if (error || !reservation) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title="Reserva no encontrada" />
        <div className="p-3 rounded-xl bg-[#fef2f2] border border-[#fee2e2] font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
          {error ?? "La reserva no existe o no está disponible"}
        </div>
        <div className="mt-4">
          <Link
            href="/admin/bookings"
            className="inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Volver a pasajeros
          </Link>
        </div>
      </main>
    );
  }

  const sb = STATUS_BADGE[reservation.status] ?? STATUS_BADGE.confirmed;
  const trip = reservation.trips;
  const route = trip?.routes;
  const passengers = reservation.reservation_passengers ?? [];
  const tripSb = trip ? TRIP_STATUS[trip.status] ?? TRIP_STATUS.active : null;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25 }}
      >
        <div className="mb-4">
          <Link
            href="/admin/bookings"
            className="inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Volver a pasajeros
          </Link>
        </div>

        <PageHeader
          title="Detalle de reserva"
          action={
            <Badge variant={sb.variant} size="md">
              {sb.label}
            </Badge>
          }
        />
      </motion.div>

      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Mobile: QR first */}
          <div className="block lg:hidden order-1">
            <Card>
              <SectionTitle as="h3" className="mb-4">
                Código QR
              </SectionTitle>
              <div className="flex flex-col items-center gap-3">
                <div className="bg-white p-3 rounded-xl border border-[rgba(0,0,0,0.06)]">
                  <QRCode value={reservation.qr_code} size={160} />
                </div>
                <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] text-center break-all">
                  {reservation.qr_code}
                </p>
              </div>
            </Card>
          </div>

          {/* Left column: info + passengers */}
          <div className="flex-1 min-w-0 space-y-6 order-2 lg:order-1">
            {/* Reservation Info */}
            <Card>
              <SectionTitle as="h3" className="mb-4">
                Información de reserva
              </SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {reservation.agencies && (
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-[var(--color-brand-cyan)]" />
                    </div>
                    <div>
                      <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                        Agencia
                      </p>
                      <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                        {reservation.agencies.name}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5 text-[var(--color-brand-cyan)]" />
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                      Destino
                    </p>
                    <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                      {route?.destination ?? "—"}
                    </p>
                  </div>
                </div>

                {trip && (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                        <Calendar className="w-5 h-5 text-[var(--color-brand-cyan)]" />
                      </div>
                      <div>
                        <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                          Fecha
                        </p>
                        <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                          {formatDate(trip.departure_time)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                        <Clock className="w-5 h-5 text-[var(--color-brand-cyan)]" />
                      </div>
                      <div>
                        <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                          Hora
                        </p>
                        <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                          {formatTime(trip.departure_time)}
                        </p>
                      </div>
                    </div>
                  </>
                )}

                {tripSb && (
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                      <Bus className="w-5 h-5 text-[var(--color-brand-cyan)]" />
                    </div>
                    <div>
                      <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                        Viaje
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                          {tripSb.label}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                    <Calendar className="w-5 h-5 text-[var(--color-brand-cyan)]" />
                  </div>
                  <div>
                    <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                      Creada
                    </p>
                    <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                      {formatDateTime(reservation.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Passengers */}
            <Card>
              <SectionTitle as="h3" className="mb-4">
                Pasajeros ({passengers.length})
              </SectionTitle>
              {passengers.length === 0 ? (
                <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                  No hay pasajeros registrados
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {passengers.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-xl border border-[rgba(0,0,0,0.06)] bg-[var(--color-brand-surface)]"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-[family-name:var(--font-heading)] font-bold text-[16px] text-[var(--color-brand-navy)]">
                          {p.seats?.seat_code ?? "—"}
                        </span>
                        <Badge
                          variant={p.boarded ? "boarded" : "confirmed"}
                          size="xs"
                        >
                          {p.boarded ? "Abordado" : "Confirmado"}
                        </Badge>
                      </div>
                      <p className="font-[family-name:var(--font-body)] font-semibold text-[13px] text-[var(--color-brand-navy)]">
                        {p.name}
                      </p>
                      <p className="font-[family-name:var(--font-body)] text-[12px] text-[var(--color-brand-muted)]">
                        {p.document}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Desktop: QR sticky right column */}
          <div className="hidden lg:block w-full lg:w-[400px] xl:w-[420px] shrink-0 order-2">
            <div className="sticky top-24">
              <Card>
                <SectionTitle as="h3" className="mb-4">
                  Código QR
                </SectionTitle>
                <div className="flex flex-col items-center gap-3">
                  <div className="bg-white p-3 rounded-xl border border-[rgba(0,0,0,0.06)]">
                    <QRCode value={reservation.qr_code} size={160} />
                  </div>
                  <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] text-center break-all">
                    {reservation.qr_code}
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </motion.div>
    </main>
  );
}
