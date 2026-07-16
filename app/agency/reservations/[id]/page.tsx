"use client";

import toast from 'react-hot-toast';
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { formatInTimezone, formatDateTimeShort } from "@/lib/timezone";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Bus,
  User,
  CreditCard,
  Phone,
  Users,
  AlertTriangle,
  Clock,
  QrCode,
} from "lucide-react";
import { agencyApi } from "@/lib/api";
import {
  subscribeToReservations,
  subscribeToReservationPassengers,
  subscribeToBoardingLogs,
} from "@/lib/realtime/subscriptions";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ReservationDetailSkeleton } from "@/components/ui/Skeleton";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { PassengerCard } from "@/components/agency/PassengerCard";
import { pageFade, staggerContainer, staggerItem } from "@/lib/motion/variants";
import { RESERVATION_STATUS_STYLES } from "@/lib/constants/reservation-status";
import type { AgencyReservation, AgencyTripPassenger } from "@/types";

const VEHICLE_LABELS: Record<string, string> = {
  bus: "Autobús",
  kia: "KIA",
  van: "Van",
  microbús: "Microbús",
};

export default function ReservationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [reservation, setReservation] = useState<AgencyReservation | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [showConfirm, setShowConfirm] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFetch = useCallback(async () => {
    try {
      setFetchError(null);
      const data = await agencyApi.getReservation(id);
      setReservation(data);
    } catch {
      setFetchError("No se pudo cargar la reserva. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  useEffect(() => {
    const debouncedRefetch = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(doFetch, 500);
    };

    const cleanups = [
      subscribeToReservations(debouncedRefetch),
      subscribeToReservationPassengers(debouncedRefetch),
      subscribeToBoardingLogs(debouncedRefetch),
    ];

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      cleanups.forEach((fn) => fn());
    };
  }, [doFetch]);

  useEffect(() => {
    return () => {
      if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
    };
  }, []);

  const handleCancel = async () => {
    setCancelLoading("loading");
    setShowConfirm(false);
    try {
      await agencyApi.cancelAgencyReservation(id);
      setCancelLoading("success");
      toast.success('Reserva cancelada correctamente');
      await doFetch();
      cancelTimerRef.current = setTimeout(() => setCancelLoading("idle"), 2500);
    } catch {
      setCancelLoading("error");
      toast.error('No se pudo cancelar la reserva');
      cancelTimerRef.current = setTimeout(() => setCancelLoading("idle"), 2500);
    }
  };

  const trip = reservation?.trips;
  const passengers = reservation?.reservation_passengers ?? [];
  const statusInfo =
    RESERVATION_STATUS_STYLES[reservation?.status ?? ""] ??
    RESERVATION_STATUS_STYLES.confirmed;

  const boardedCount = useMemo(
    () => passengers.filter((p) => p.boarded).length,
    [passengers]
  );
  const totalPassengers = passengers.length;
  const progressPercent =
    totalPassengers > 0 ? (boardedCount / totalPassengers) * 100 : 0;

  const mappedPassengers: AgencyTripPassenger[] = useMemo(
    () =>
      passengers.map((p) => ({
        id: p.id,
        name: p.name,
        document: p.document,
        phone: p.phone ?? null,
        seat_code: p.seats?.seat_code ?? "—",
        reservation_id: id,
        reservation_status: p.status,
        booker_name: reservation?.booker_name ?? "",
        boarded: p.boarded ?? false,
      })),
    [passengers, id, reservation?.booker_name]
  );

  const qrSrc = reservation?.qr_data_url || reservation?.qr_code || null;

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <ReservationDetailSkeleton />
      </main>
    );
  }

  if (fetchError || !reservation) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title="Reserva no encontrada" />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle
              className="w-5 h-5 text-[#ef4444] shrink-0"
              strokeWidth={1.75}
            />
            <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
              {fetchError ?? "La reserva no existe o fue eliminada."}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={doFetch}>
            Reintentar
          </Button>
        </motion.div>
        <button
          type="button"
          onClick={() => router.push("/agency/reservations")}
          className="inline-flex items-center gap-2 mt-4 text-sm font-semibold text-[var(--color-brand-cyan)] bg-transparent border-none cursor-pointer hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a reservas
        </button>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-4">
        <button
          type="button"
          onClick={() => router.push("/agency/reservations")}
          className="flex items-center gap-1.5 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] cursor-pointer bg-transparent border-none hover:text-[var(--color-brand-navy)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a reservas
        </button>
      </div>

      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        exit="exit"
        transition={{ duration: 0.25 }}
      >
        <PageHeader
          title={`Reserva #${reservation.id.slice(0, 8)}`}
          action={
            <div className="flex items-center justify-between gap-3 w-full">
              <Badge variant={statusInfo.variant} size="md">
                {statusInfo.label}
              </Badge>
              {reservation.status === "confirmed" && (
                <Button
                  variant="destructive"
                  size="sm"
                  loading={cancelLoading === "loading"}
                  feedback={
                    cancelLoading === "success"
                      ? "success"
                      : cancelLoading === "error"
                      ? "error"
                      : null
                  }
                  onClick={() => setShowConfirm(true)}
                >
                  Cancelar reserva
                </Button>
              )}
            </div>
          }
        />
      </motion.div>

      {cancelLoading === "error" && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 font-[family-name:var(--font-body)] text-sm text-red-600">
          Error al cancelar la reserva. Intenta de nuevo.
        </div>
      )}

      <ConfirmModal
        open={showConfirm}
        title="¿Cancelar reserva?"
        message="Se liberarán todos los asientos de esta reserva. Esta acción no se puede deshacer."
        confirmLabel="Sí, cancelar"
        cancelLabel="Volver"
        onConfirm={handleCancel}
        onCancel={() => setShowConfirm(false)}
      />

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-4"
      >
        {/* ── Left column: Viaje + Reservador ── */}
        <motion.div variants={staggerItem} className="space-y-6">
          {/* Viaje */}
          <Card>
            <SectionTitle>Viaje</SectionTitle>
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                  <MapPin
                    className="w-4 h-4 text-[var(--color-brand-cyan)]"
                    strokeWidth={1.75}
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                    Destino
                  </p>
                  <p className="font-[family-name:var(--font-heading)] font-bold text-sm text-[var(--color-brand-navy)] truncate">
                    {trip?.routes?.destination ?? "—"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                  <Calendar
                    className="w-4 h-4 text-[var(--color-brand-cyan)]"
                    strokeWidth={1.75}
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                    Fecha
                  </p>
                  <p className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)]">
                    {trip?.departure_time
                      ? formatInTimezone(trip.departure_time)
                      : "—"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                  <Bus
                    className="w-4 h-4 text-[var(--color-brand-cyan)]"
                    strokeWidth={1.75}
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-[family-name:var(--font-body)] text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                    Vehículo
                  </p>
                  <p className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)] capitalize">
                    {VEHICLE_LABELS[trip?.vehicle_type ?? ""] ??
                      trip?.vehicle_type ??
                      "—"}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* Reservador */}
          <Card>
            <SectionTitle>Reservador</SectionTitle>
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
                  <User
                    className="w-4 h-4 text-[var(--color-brand-cyan)]"
                    strokeWidth={1.75}
                  />
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
                  <CreditCard
                    className="w-4 h-4 text-[var(--color-brand-cyan)]"
                    strokeWidth={1.75}
                  />
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
                    <Phone
                      className="w-4 h-4 text-[var(--color-brand-cyan)]"
                      strokeWidth={1.75}
                    />
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

        {/* ── Right column: QR + Quick Info ── */}
        <motion.div variants={staggerItem} className="space-y-6">
          {/* QR Card */}
          <Card className="flex flex-col items-center py-6">
            <div className="bg-white p-3 rounded-2xl border-2 border-[rgba(0,212,255,0.2)] shadow-[0_2px_12px_rgba(0,212,255,0.08)]">
              {qrSrc ? (
                <img
                  src={qrSrc}
                  alt="Código QR de la reserva"
                  className="w-[140px] h-[140px] sm:w-[160px] sm:h-[160px]"
                />
              ) : (
                <div className="w-[140px] h-[140px] sm:w-[160px] sm:h-[160px] flex flex-col items-center justify-center bg-slate-50 rounded-xl border border-dashed border-slate-200 gap-2">
                  <QrCode
                    className="w-8 h-8 text-slate-300"
                    strokeWidth={1.5}
                  />
                  <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                    Sin código QR
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 text-center">
              <p className="font-[family-name:var(--font-heading)] font-bold text-sm text-[var(--color-brand-navy)]">
                {reservation.qr_code}
              </p>
              <Badge variant={statusInfo.variant} size="sm" className="mt-1.5">
                {statusInfo.label}
              </Badge>
            </div>
          </Card>

          {/* Quick Info */}
          <Card>
            <div className="space-y-3 text-sm">
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
                  {passengers
                    .map((p) => p.seats?.seat_code)
                    .filter(Boolean)
                    .join(", ") || "—"}
                </span>
              </div>
            </div>
          </Card>
        </motion.div>
      </motion.div>

      {/* ── Passengers section (full width) ── */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="mt-6"
      >
        <motion.div variants={staggerItem}>
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <SectionTitle>Pasajeros ({totalPassengers})</SectionTitle>
              {totalPassengers > 0 && (
                <div className="flex items-center gap-3">
                  <span className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
                    {boardedCount} / {totalPassengers} abordados
                  </span>
                  <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-[#10b981]"
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPercent}%` }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                  </div>
                </div>
              )}
            </div>

            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
            >
              {mappedPassengers.map((p) => (
                <PassengerCard
                  key={p.id}
                  passenger={p}
                  showReservationId={false}
                />
              ))}
            </motion.div>
          </Card>
        </motion.div>
      </motion.div>
    </main>
  );
}
