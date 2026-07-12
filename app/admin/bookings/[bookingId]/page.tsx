"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { QRCode } from "react-qr-code";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

type ReservationDetail = {
  id: string;
  customer_name: string;
  passenger_cedula: string;
  seat_code: string;
  qr_code: string;
  status: string;
  transaction_id: string;
  created_at: string;
  trips: {
    id: string;
    departure_time: string;
    status: string;
    routes: {
      origin: string;
      destination: string;
    } | null;
  } | null;
};

const STATUS_STYLES: Record<string, { label: string; pill: string }> = {
  confirmed: { label: "Confirmada", pill: "bg-emerald-50 text-emerald-600" },
  cancelled: { label: "Cancelada", pill: "bg-red-50 text-red-500" },
  boarded: { label: "Abordado", pill: "bg-blue-50 text-blue-600" },
};

export default function BookingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const bookingId = params.bookingId as string;

  const [reservation, setReservation] = useState<ReservationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  useEffect(() => {
    const fetchReservation = async () => {
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();
        const { data } = await supabase
          .from('reservations')
          .select('*, trips(*, routes(*))')
          .eq('transaction_id', bookingId)
          .single();
        if (!data) throw new Error("No se encontró la reserva");
        setReservation(data as any);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al cargar");
      } finally {
        setLoading(false);
      }
    };
    fetchReservation();
  }, [bookingId]);

  const handleStatusChange = async (newStatus: string) => {
    setUpdating(true);
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from('reservations')
        .update({ status: newStatus })
        .eq('id', bookingId);
      if (updateError) throw updateError;
      setReservation((prev) => prev ? { ...prev, status: newStatus } : null);
    } catch {
      setError("Error al cambiar estado");
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-100 min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-navy" />
      </div>
    );
  }

  if (error || !reservation) {
    return (
      <div className="bg-slate-100 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="bg-white rounded-2xl p-8 text-center shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <p className="font-['Poppins',sans-serif] font-normal text-sm text-red-500 mb-3">
              {error ?? "Reserva no encontrada"}
            </p>
            <Link
              href="/admin/bookings"
              className="inline-block px-5 py-2.5 rounded-xl bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-sm no-underline hover:bg-brand-blue transition-colors"
            >
              Volver a pasajeros
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const bs = STATUS_STYLES[reservation.status] ?? STATUS_STYLES.confirmed;
  const qrValue = reservation.qr_code;
  const seatCode = reservation.seat_code ?? "—";
  const routeOrigin = reservation.trips?.routes?.origin ?? "—";
  const routeDest = reservation.trips?.routes?.destination ?? "—";
  const departure = reservation.trips?.departure_time
    ? format(new Date(reservation.trips.departure_time), "dd/MM/yyyy HH:mm")
    : "—";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <p className="font-['Poppins',sans-serif] font-normal text-xs text-brand-muted">
          <Link href="/admin" className="text-brand-cyan no-underline hover:underline">Admin</Link>
          {" / "}
          <Link href="/admin/bookings" className="text-brand-cyan no-underline hover:underline">Pasajeros</Link>
          {" / Detalle"}
        </p>
        <h1 className="font-['Montserrat',sans-serif] font-extrabold text-[22px] sm:text-2xl text-brand-navy mt-1">
          Detalle del pasajero
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-1 h-[18px] bg-brand-cyan rounded-sm" />
              <h2 className="font-['Montserrat',sans-serif] font-bold text-base text-brand-navy">
                Información del pasajero
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-['Poppins',sans-serif] font-medium text-[11px] text-brand-muted uppercase tracking-wider mb-1">
                  Nombre completo
                </label>
                <p className="font-['Poppins',sans-serif] font-semibold text-[15px] text-brand-navy">
                  {reservation.customer_name}
                </p>
              </div>
              <div>
                <label className="block font-['Poppins',sans-serif] font-medium text-[11px] text-brand-muted uppercase tracking-wider mb-1">
                  Cédula / Identificación
                </label>
                <p className="font-['Poppins',sans-serif] font-semibold text-[15px] text-brand-navy">
                  {reservation.passenger_cedula ?? "—"}
                </p>
              </div>
              <div>
                <label className="block font-['Poppins',sans-serif] font-medium text-[11px] text-brand-muted uppercase tracking-wider mb-1">
                  Estado
                </label>
                <span className={`inline-block font-['Poppins',sans-serif] font-semibold text-[11px] px-3 py-1 rounded-full ${bs.pill}`}>
                  {bs.label}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-1 h-[18px] bg-brand-cyan rounded-sm" />
              <h2 className="font-['Montserrat',sans-serif] font-bold text-base text-brand-navy">
                Información del viaje
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-['Poppins',sans-serif] font-medium text-[11px] text-brand-muted uppercase tracking-wider mb-1">
                  Ruta
                </label>
                <p className="font-['Poppins',sans-serif] font-semibold text-[15px] text-brand-navy">
                  {routeOrigin} → {routeDest}
                </p>
              </div>
              <div>
                <label className="block font-['Poppins',sans-serif] font-medium text-[11px] text-brand-muted uppercase tracking-wider mb-1">
                  Salida
                </label>
                <p className="font-['Poppins',sans-serif] font-normal text-[14px] text-brand-navy">{departure}</p>
              </div>
              <div>
                <label className="block font-['Poppins',sans-serif] font-medium text-[11px] text-brand-muted uppercase tracking-wider mb-1">
                  Asiento
                </label>
                <p className="font-['Poppins',sans-serif] font-bold text-[18px] text-brand-navy bg-slate-100 inline-block px-3 py-1 rounded-lg">{seatCode}</p>
              </div>

            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-1 h-[18px] bg-brand-cyan rounded-sm" />
              <h2 className="font-['Montserrat',sans-serif] font-bold text-base text-brand-navy">Acciones</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              {reservation.status === "confirmed" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setCancelModalOpen(true)}
                    disabled={updating}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-50 text-red-500 font-['Poppins',sans-serif] font-semibold text-sm border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-100 transition-colors"
                  >
                    {updating ? (
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500" />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M4 4l8 8M12 4l-8 8" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                    Cancelar reserva
                  </button>
                  <ConfirmModal
                    open={cancelModalOpen}
                    title="Cancelar reserva"
                    message="¿Estás seguro de cancelar esta reserva? El asiento quedará disponible para otros pasajeros."
                    confirmLabel="Cancelar reserva"
                    cancelLabel="Volver"
                    onConfirm={() => {
                      setCancelModalOpen(false);
                      handleStatusChange("cancelled");
                    }}
                    onCancel={() => setCancelModalOpen(false)}
                  />
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleStatusChange("confirmed")}
                  disabled={updating}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-50 text-emerald-600 font-['Poppins',sans-serif] font-semibold text-sm border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-100 transition-colors"
                >
                  {updating ? (
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600" />
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8l3 3 7-7" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  Reactivar reserva
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-[0_2px_8px_rgba(0,0,0,0.07)] sticky top-20">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-1 h-[18px] bg-brand-cyan rounded-sm" />
              <h2 className="font-['Montserrat',sans-serif] font-bold text-sm text-brand-navy">Código QR</h2>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="bg-white p-3 rounded-xl border border-slate-200">
                <QRCode value={qrValue} size={160} />
              </div>
              <p className="font-['Poppins',sans-serif] font-normal text-[11px] text-brand-muted text-center break-all">{qrValue}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
