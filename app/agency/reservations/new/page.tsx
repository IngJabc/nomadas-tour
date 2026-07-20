"use client";

import toast from 'react-hot-toast';
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  Suspense,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Ticket,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Clock,
  Bus as BusIcon,
  Share2,
} from "lucide-react";
import { formatDateTimeShort, formatDateLong, formatTime12h } from "@/lib/timezone";
import { agencyApi } from "@/lib/api";
import { subscribeToTripSeats } from "@/lib/realtime/subscriptions";
import {
  Seat,
  PassengerData,
  AgencyTripListItem,
  ReservationOrigin,
} from "@/types";
import type { ReservationTicketData } from "@/types/reservation";
import { useReservationWizard } from "@/hooks/useReservationWizard";
import { useSeatLocking } from "@/hooks/useSeatLocking";
import { useReservationSubmit } from "@/hooks/useReservationSubmit";
import { useCapture } from "@/hooks/useCapture";
import { validateForm } from "@/lib/reservations/validateForm";
import { BusLayout } from "@/components/bus/BusLayout";
import { BusLayoutSnapshot } from "@/components/bus/BusLayoutSnapshot";
import { withReposition } from "@/lib/capture-reposition";
import { PassengerForm } from "@/components/booking/PassengerForm";
import { ReservationSummary } from "@/components/booking/ReservationSummary";
import { AgencyTripCardSkeleton, CardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { AgencyTripCard } from "@/components/agency/AgencyTripCard";
import { ReservationTicket } from "@/components/reservations/ReservationTicket";
import { ReservationTicketActions } from "@/components/reservations/ReservationTicketActions";
import { pageFade, staggerContainer, staggerItem } from "@/lib/motion/variants";
import { isForcedLogout } from "@/lib/auth/session-handler";

// ─── Page wrapper ────────────────────────────────────────────────────
export default function NewAgencyReservationPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <CardSkeleton />
        </main>
      }
    >
      <NewReservationContent />
    </Suspense>
  );
}

// ─── Main content ────────────────────────────────────────────────────
function NewReservationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDeepLink = searchParams?.has("trip") ?? false;
  const tripIdParam = searchParams?.get("trip") ?? null;
  const origin: ReservationOrigin =
    searchParams?.get("source") === "trips"
      ? "agency_trips"
      : "new_reservation";

  // ─── Auth ─────────────────────────────────────────────────────────
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        setUserId(session?.user?.id ?? null);
      } catch {
        /* silent */
      }
    })();
  }, []);

  // ─── beforeunload — only show dialog if user has locked seats ──────
  const selectedSeatsCountRef = useRef(0);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isForcedLogout()) return;
      if (selectedSeatsCountRef.current > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // ─── Hooks ────────────────────────────────────────────────────────
  const wizard = useReservationWizard({ isDeepLink, origin });
  const addToast = useCallback((message: string, type: 'error' | 'info') => {
    if (type === 'error') toast.error(message);
    else toast(message);
  }, []);
  const tripCancelledHandledRef = useRef(false);
  const locking = useSeatLocking({ userId, onSeatLost: (seatCode) => {
    addToast(`El asiento ${seatCode} ya no está disponible`, "info");
  }, onTripCancelled: () => {
    if (tripCancelledHandledRef.current) return;
    tripCancelledHandledRef.current = true;
    toast.error("Este viaje fue cancelado por el administrador. La reserva no puede continuar.");
    setTimeout(() => router.push("/agency/trips"), 300);
  }});

  // Keep ref in sync for beforeunload event handler
  useEffect(() => {
    selectedSeatsCountRef.current = locking.selectedSeats.length;
  }, [locking.selectedSeats.length]);

  const [bookerName, setBookerName] = useState("");
  const [bookerDocument, setBookerDocument] = useState("");
  const [passengers, setPassengers] = useState<PassengerData[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ─── Success view (post-redirect) ────────────────────────────────
  const [successData, setSuccessData] = useState<ReservationTicketData | null>(null);
  const [successLoading, setSuccessLoading] = useState(false);
  const [successError, setSuccessError] = useState<string | null>(null);

  const { captureRef, download, share } = useCapture({
    filename: successData ? `boleto-${successData.qr_code}` : 'boleto',
  });

  const shareWithText = useCallback(async () => {
    if (!successData?.trip) return share();
    const text = `Reserva confirmada — ${successData.trip.origin} → ${successData.trip.destination} — ${formatDateLong(successData.trip.departure_time)}`;
    return share({ text });
  }, [share, successData]);

  // ─── Seat map capture ────────────────────────────────────────────
  const { captureRef: captureRefMap, share: shareMap } = useCapture({
    filename: locking.selectedTrip
      ? `mapa-${locking.selectedTrip.routes?.origin}-${locking.selectedTrip.routes?.destination}`
      : 'mapa-asientos',
  });

  const handleShareMap = useCallback(async () => {
    const el = captureRefMap.current;
    if (!el || !locking.selectedTrip) return;
    const trip = locking.selectedTrip;
    const text = `Mapa de asientos — ${trip.routes?.origin ?? ''} → ${trip.routes?.destination ?? ''} — ${formatDateLong(trip.departure_time)}`;
    const { shared } = await withReposition(el, () => shareMap({ text }));
    if (!shared) {
      toast('Mapa descargado', { icon: '🚌' });
    }
  }, [captureRefMap, shareMap, locking.selectedTrip]);

  const [reservationIdFromUrl, setReservationIdFromUrl] = useState<string | null>(
    searchParams?.get("reservation_id") ?? null
  );

  const onSuccess = useCallback((reservationId: string) => {
    locking.unlockAllCurrent();
    setReservationIdFromUrl(reservationId);
    router.replace(`/agency/reservations/new?reservation_id=${reservationId}`);
  }, [locking, router]);

  const submit = useReservationSubmit({
    trip: locking.selectedTrip,
    selectedSeats: locking.selectedSeats,
    bookerName,
    bookerDocument,
    passengers,
    onSuccess,
  });

  // ─── Load trips list ──────────────────────────────────────────────
  const [trips, setTrips] = useState<AgencyTripListItem[]>([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [tripsError, setTripsError] = useState<string | null>(null);

  const loadTripsList = useCallback(async () => {
    setTripsLoading(true);
    setTripsError(null);
    try {
      const data = await agencyApi.listTrips();
      setTrips(data || []);
    } catch (err) {
      setTripsError(
        err instanceof Error ? err.message : "Error al cargar viajes"
      );
    } finally {
      setTripsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTripsList();
  }, [loadTripsList]);

  // ─── Fetch reservation for success view ────────────────────────────
  useEffect(() => {
    if (!reservationIdFromUrl) return;

    const fetchReservation = async () => {
      setSuccessLoading(true);
      setSuccessError(null);
      try {
        const data = await agencyApi.getReservation(reservationIdFromUrl);
        const ticketData: ReservationTicketData = {
          reservation_id: data.id,
          qr_code: data.qr_code,
          status: data.status,
          created_at: data.created_at,
          booker_name: data.booker_name,
          booker_document: data.booker_document,
          booker_phone: data.booker_phone,
          trip: data.trips
            ? {
                id: data.trips.id,
                departure_time: data.trips.departure_time,
                origin: data.trips.routes?.origin ?? '',
                destination: data.trips.routes?.destination ?? '',
                vehicle_type: data.trips.vehicle_type as 'bus' | 'kia',
                status: 'active',
              }
            : null,
          passengers: (data.reservation_passengers ?? []).map((p: any) => ({
            id: p.id,
            name: p.name,
            document: p.document,
            seat_code: p.seats?.seat_code ?? '—',
            boarded: p.boarded ?? false,
          })),
        };
        setSuccessData(ticketData);
      } catch {
        setSuccessError('No se pudo cargar la reserva.');
      } finally {
        setSuccessLoading(false);
      }
    };

    fetchReservation();
  }, [reservationIdFromUrl]);

  // ─── Realtime: trips list seat counts ──────────────────────────────
  useEffect(() => {
    if (wizard.step !== "select_trip" || trips.length === 0) return;

    const tripIds = trips.map((t) => t.id);
    const debounceTimerRef: { current: ReturnType<typeof setTimeout> | null } =
      { current: null };
    const pendingTripIds = new Set<string>();

    const flush = async () => {
      if (pendingTripIds.size === 0) return;
      const idsToFetch = Array.from(pendingTripIds);
      pendingTripIds.clear();

      for (const tripId of idsToFetch) {
        try {
          const fresh = await agencyApi.getTrip(tripId);
          const seats = fresh.seats ?? [];
          const available_seats = seats.filter(
            (s: Seat) => s.status === "available"
          ).length;
          const reserved_seats = seats.filter(
            (s: Seat) => s.status === "reserved" || s.status === "boarded"
          ).length;

          setTrips((prev) => {
            const idx = prev.findIndex((t) => t.id === tripId);
            if (idx === -1) return prev;
            const updated = [...prev];
            updated[idx] = { ...updated[idx], available_seats, reserved_seats };
            return updated;
          });
        } catch {
          /* silent */
        }
      }
    };

    const handleSeatUpdate = ({ seat }: { seat: any }) => {
      const tripId = seat.trip_id as string;
      if (!tripId) return;
      pendingTripIds.add(tripId);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(flush, 500);
    };

    const cleanup = subscribeToTripSeats(tripIds, handleSeatUpdate);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      cleanup();
    };
  }, [wizard.step, trips.length]);

  // ─── Deep link ────────────────────────────────────────────────────
  useEffect(() => {
    if (!tripIdParam) return;
    locking.loadDeepLinkTrip(tripIdParam).then((ok) => {
      if (ok) wizard.goToSeats();
    });
  }, [tripIdParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Step transitions ─────────────────────────────────────────────
  const handleBackFromSeats = useCallback(async () => {
    await locking.unlockAllCurrent();
    locking.resetSeats();
    wizard.goBackFromSeats();
  }, [locking, wizard]);

  const handleSelectTrip = useCallback(
    async (tripId: string) => {
      await locking.loadTrip(tripId);
      wizard.goToSeats();
    },
    [locking, wizard]
  );

  const handleProceedToForm = useCallback(() => {
    if (locking.selectedSeats.length === 0) return;
    const sorted = [...locking.selectedSeats].sort((a, b) => {
      return (
        parseInt(a.seat_code.slice(1), 10) - parseInt(b.seat_code.slice(1), 10)
      );
    });
    // Initialize passengers for sorted seats
    setPassengers(
      sorted.map((s) => ({
        seat_id: s.id,
        seat_code: s.seat_code,
        name: "",
        document: "",
        phone: "",
      }))
    );
    setErrors({});
    wizard.goToPassengerForm();
  }, [locking.selectedSeats, wizard]);

  const handleProceedToSummary = useCallback(() => {
    const err = validateForm(
      "passenger_form",
      locking.selectedTrip,
      locking.selectedSeats,
      bookerName,
      bookerDocument,
      passengers
    );
    setErrors(err);
    if (Object.keys(err).length > 0) return;
    wizard.goToSummary();
  }, [
    locking.selectedTrip,
    locking.selectedSeats,
    bookerName,
    bookerDocument,
    passengers,
    wizard,
  ]);

  const handleConfirm = useCallback(async () => {
    const err = validateForm(
      "summary",
      locking.selectedTrip,
      locking.selectedSeats,
      bookerName,
      bookerDocument,
      passengers
    );
    setErrors(err);
    if (Object.keys(err).length > 0) return;
    await submit.submit();
  }, [
    locking.selectedTrip,
    locking.selectedSeats,
    bookerName,
    bookerDocument,
    passengers,
    submit,
  ]);

  const handleReset = useCallback(() => {
    setBookerName("");
    setBookerDocument("");
    setPassengers([]);
    setErrors({});
    setReservationIdFromUrl(null);
    setSuccessData(null);
    submit.resetResult();
    submit.clearError();
    locking.resetSeats();
    wizard.resetWizard();
    tripCancelledHandledRef.current = false;
  }, [submit, locking, wizard]);

  const handleBookerNameChange = useCallback((v: string) => setBookerName(v), []);
  const handleBookerDocumentChange = useCallback((v: string) => setBookerDocument(v), []);

  const handlePassengerUpdate = useCallback(
    (seatId: string, field: keyof PassengerData, value: string) => {
      setPassengers((prev) =>
        prev.map((p) => (p.seat_id === seatId ? { ...p, [field]: value } : p))
      );
    },
    []
  );

  const handleEditPassengers = useCallback(() => {
    wizard.goToPassengerEntry();
  }, [wizard]);

  const handleToggleSeat = useCallback(
    (seat: Seat) => {
      locking.toggleSeat(seat, addToast);
    },
    [locking, addToast]
  );

  // ─── Auto-revert when all seats lost on later steps ────────────────
  useEffect(() => {
    if (
      !tripCancelledHandledRef.current &&
      (wizard.step === "passenger_form" || wizard.step === "summary") &&
      locking.selectedSeats.length === 0
    ) {
      addToast(
        "Tus asientos expiraron. Selecciona nuevamente.",
        "info"
      );
      wizard.goToSeatSelection();
    }
  }, [wizard.step, locking.selectedSeats.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Derived state ────────────────────────────────────────────────
  const availableTrips = useMemo(
    () => trips.filter((t) => t.status === "active" && t.available_seats > 0),
    [trips]
  );

  // ═════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Deep link error */}
      {locking.deepLinkError && (
        <motion.div
          variants={pageFade}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.25 }}
        >
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]">
              <AlertTriangle
                className="w-5 h-5 text-[#ef4444] shrink-0"
                strokeWidth={1.75}
              />
              <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
                Este viaje ya no está disponible.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push("/agency/trips")}
            >
              Volver a Mis Viajes
            </Button>
          </div>
        </motion.div>
      )}

      {/* Stepper */}
      {!locking.deepLinkError && !reservationIdFromUrl && (
        <motion.div
          variants={pageFade}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.2 }}
          className="w-full mb-8"
        >
          <div className="flex items-center w-full">
            {wizard.stepDefs.map((s, i) => {
              const done = i < wizard.currentStepIdx;
              const active = wizard.step === s.key;
              return (
                <div
                  key={s.key}
                  className="flex items-center flex-1 last:flex-none"
                >
                  <span
                    className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold font-[family-name:var(--font-body)] transition-all duration-200 shrink-0 ${
                      done || active
                        ? "bg-[var(--color-brand-cyan)] text-white"
                        : "bg-[#e5e7eb] text-[var(--color-brand-muted)]"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={`font-[family-name:var(--font-body)] font-medium text-xs transition-colors duration-200 ml-1.5 whitespace-nowrap ${
                      active || done
                        ? "text-[var(--color-brand-navy)]"
                        : "text-[var(--color-brand-muted)]"
                    } hidden sm:inline`}
                  >
                    {s.label}
                  </span>
                  {i < 3 && (
                    <div
                      className={`flex-1 h-px mx-2 transition-colors duration-200 ${
                        i < wizard.currentStepIdx
                          ? "bg-[var(--color-brand-cyan)]"
                          : "bg-[#e5e7eb]"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Main content card */}
      {!locking.deepLinkError && (
        <motion.div
          variants={pageFade}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.25, delay: 0.1 }}
          className="bg-[var(--color-brand-surface)] rounded-2xl p-6 border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
        >
          <AnimatePresence mode="wait">
            {/* ─── select_trip ──────────────────────────────────────────── */}
            {wizard.step === "select_trip" && (
              <motion.div
                key="select_trip"
                variants={pageFade}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
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

                <div className="flex items-center gap-3 mb-6">
                  <div className="w-1 h-[22px] bg-[var(--color-brand-cyan)] rounded-sm" />
                  <h2 className="font-[family-name:var(--font-heading)] font-bold text-xl text-[var(--color-brand-navy)]">
                    Nueva reserva
                  </h2>
                </div>

                {tripsLoading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3].map((i) => (
                      <AgencyTripCardSkeleton key={i} />
                    ))}
                  </div>
                ) : tripsError ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]">
                      <div className="flex items-center gap-3">
                        <AlertTriangle
                          className="w-5 h-5 text-[#ef4444] shrink-0"
                          strokeWidth={1.75}
                        />
                        <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
                          {tripsError}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={loadTripsList}
                      >
                        Reintentar
                      </Button>
                    </div>
                  </motion.div>
                ) : availableTrips.length === 0 ? (
                  <EmptyState
                    icon={<Ticket className="w-8 h-8" />}
                    message={
                      trips.length === 0
                        ? "No hay viajes disponibles para tu agencia"
                        : "No hay viajes activos con asientos disponibles"
                    }
                    action={{
                      label: "Regresar",
                      onClick: () => router.push("/agency"),
                    }}
                  />
                ) : (
                  <motion.div
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
                    variants={staggerContainer}
                    initial="hidden"
                    animate="visible"
                  >
                    {availableTrips.map((trip) => (
                      <motion.div key={trip.id} variants={staggerItem}>
                        <AgencyTripCard
                          trip={trip}
                          onSelect={() => handleSelectTrip(trip.id)}
                        />
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* ─── select_seats ────────────────────────────────────────── */}
            {wizard.step === "select_seats" && (
              <motion.div
                key="select_seats"
                variants={pageFade}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <button
                  type="button"
                  onClick={handleBackFromSeats}
                  className="flex items-center gap-1.5 mb-4 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] cursor-pointer bg-transparent border-none hover:text-[var(--color-brand-navy)] transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {wizard.origin === "agency_trips"
                    ? "Volver a Mis Viajes"
                    : "Volver a viajes"}
                </button>

                {locking.tripLoading ? (
                  <div className="flex flex-col lg:flex-row gap-6">
                    <div className="lg:w-[300px] shrink-0 space-y-3 bg-[var(--color-brand-surface)] rounded-2xl p-5 border border-[rgba(0,0,0,0.06)]">
                      <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 bg-slate-200 rounded-lg animate-pulse" />
                        <div className="space-y-1.5 flex-1">
                          <div className="h-3 w-16 bg-slate-200 rounded animate-pulse" />
                          <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 bg-slate-200 rounded-lg animate-pulse" />
                        <div className="space-y-1.5 flex-1">
                          <div className="h-3 w-16 bg-slate-200 rounded animate-pulse" />
                          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 bg-slate-200 rounded-lg animate-pulse" />
                        <div className="space-y-1.5 flex-1">
                          <div className="h-3 w-16 bg-slate-200 rounded animate-pulse" />
                          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 bg-slate-200 rounded-lg animate-pulse" />
                        <div className="space-y-1.5 flex-1">
                          <div className="h-3 w-20 bg-slate-200 rounded animate-pulse" />
                          <div className="h-5 w-10 bg-slate-200 rounded animate-pulse" />
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 flex justify-center">
                      <div className="w-[310px] h-[420px] bg-slate-100 rounded-[40px] animate-pulse" />
                    </div>
                  </div>
                ) : !locking.selectedTrip ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]">
                      <div className="flex items-center gap-3">
                        <AlertTriangle
                          className="w-5 h-5 text-[#ef4444] shrink-0"
                          strokeWidth={1.75}
                        />
                        <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
                          No se pudo cargar el viaje
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleBackFromSeats}
                      >
                        Volver
                      </Button>
                    </div>
                  </motion.div>
                ) : (
                  <>
                    {/* Hidden snapshot for seat map capture */}
                    <div
                      ref={captureRefMap}
                      style={{
                        position: 'fixed',
                        left: '-9999px',
                        top: 0,
                        zIndex: -1,
                        pointerEvents: 'none',
                      }}
                    >
                      {locking.selectedTrip && (
                        <BusLayoutSnapshot
                          seats={locking.seatsMap}
                          vehicleType={locking.selectedTrip.vehicle_type ?? 'bus'}
                          trip={{
                            origin: locking.selectedTrip.routes?.origin ?? '',
                            destination: locking.selectedTrip.routes?.destination ?? '',
                            departure_time: locking.selectedTrip.departure_time,
                          }}
                        />
                      )}
                    </div>

                    <div className="flex flex-col lg:flex-row gap-6">
                      {/* Left — Trip info */}
                      <motion.div
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25 }}
                        className="lg:w-[300px] shrink-0 self-start bg-[var(--color-brand-surface)] rounded-2xl p-5 border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
                      >
                        <p className="font-[family-name:var(--font-heading)] font-bold text-[13px] text-[var(--color-brand-navy)] uppercase tracking-wider mb-4 border-l-4 border-[var(--color-brand-cyan)] pl-3">
                          Resumen del viaje
                        </p>
                        <div className="space-y-4">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[rgba(0,212,255,0.1)] shrink-0">
                              <ArrowRight className="w-4 h-4 text-[var(--color-brand-cyan)]" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider">
                                Destino
                              </p>
                              <p className="font-[family-name:var(--font-heading)] font-bold text-sm text-[var(--color-brand-navy)] truncate">
                                {locking.selectedTrip.routes?.destination ??
                                  "—"}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[rgba(0,212,255,0.1)] shrink-0">
                              <Calendar className="w-4 h-4 text-[var(--color-brand-cyan)]" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider">
                                Salida
                              </p>
                              <p className="font-[family-name:var(--font-heading)] font-bold text-sm text-[var(--color-brand-navy)]">
                                {locking.selectedTrip.departure_time
                                  ? formatDateLong(locking.selectedTrip.departure_time)
                                  : "—"}
                              </p>
                              <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)]">
                                {locking.selectedTrip.departure_time
                                  ? formatTime12h(locking.selectedTrip.departure_time)
                                  : ""}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[rgba(0,212,255,0.1)] shrink-0">
                              <BusIcon className="w-4 h-4 text-[var(--color-brand-cyan)]" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider">
                                Vehículo
                              </p>
                              <p className="font-[family-name:var(--font-heading)] font-bold text-sm text-[var(--color-brand-navy)]">
                                {locking.selectedTrip.vehicle_type === "bus"
                                  ? "Autobús"
                                  : "KIA"}
                              </p>
                              <p className="font-[family-name:var(--font-body)] font-normal text-[12px] text-[var(--color-brand-muted)]">
                                {locking.selectedTrip.seats?.length ?? 0}{" "}
                                asientos
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[rgba(0,212,255,0.1)] shrink-0">
                              <Ticket className="w-4 h-4 text-[var(--color-brand-cyan)]" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wider">
                                Disponibles
                              </p>
                              <p className="font-[family-name:var(--font-heading)] font-bold text-[18px] text-[var(--color-brand-cyan)]">
                                {(() => {
                                  const seats =
                                    locking.selectedTrip.seats ?? [];
                                  return seats.filter(
                                    (s: Seat) => s.status === "available"
                                  ).length;
                                })()}
                              </p>
                            </div>
                          </div>
                        </div>
                      </motion.div>

                      {/* Right — Bus layout */}
                      <motion.div
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25, delay: 0.05 }}
                        className="flex-1 flex flex-col items-center"
                      >
                        <BusLayout
                          seats={locking.seatsMap}
                          selectedSeats={locking.selectedSeats}
                          onToggleSeat={handleToggleSeat}
                          vehicleType={
                            locking.selectedTrip.vehicle_type ?? "bus"
                          }
                          userId={userId}
                        />
                      </motion.div>
                    </div>

                    {/* Footer */}
                    <div className="flex flex-col gap-3 mt-6 sm:flex-row sm:items-center sm:justify-between">
                      <span className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)]">
                        {locking.selectedSeats.length} asiento
                        {locking.selectedSeats.length !== 1 ? "s" : ""}{" "}
                        seleccionado
                        {locking.selectedSeats.length !== 1 ? "s" : ""}
                      </span>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleShareMap}
                        >
                          <Share2 className="w-4 h-4" />
                          Compartir mapa
                        </Button>
                        <Button
                          variant="primary"
                          onClick={handleProceedToForm}
                          disabled={locking.selectedSeats.length === 0}
                        >
                          Continuar
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {/* ─── passenger_form ──────────────────────────────────────── */}
            {wizard.step === "passenger_form" && (
              <motion.div
                key="passenger_form"
                variants={pageFade}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <button
                  type="button"
                  onClick={() => wizard.goToSeatSelection()}
                  className="flex items-center gap-1.5 mb-4 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] cursor-pointer bg-transparent border-none hover:text-[var(--color-brand-navy)] transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Volver a asientos
                </button>

                <PassengerForm
                  passengers={passengers}
                  onUpdate={handlePassengerUpdate}
                  onNext={handleProceedToSummary}
                  errors={errors}
                  bookerName={bookerName}
                  bookerDocument={bookerDocument}
                  onBookerNameChange={handleBookerNameChange}
                  onBookerDocumentChange={handleBookerDocumentChange}
                  bookerErrors={{
                    name: errors["booker_name"],
                    document: errors["booker_document"],
                  }}
                />
              </motion.div>
            )}

            {/* ─── summary ─────────────────────────────────────────────── */}
            {wizard.step === "summary" && !reservationIdFromUrl && (
              <motion.div
                key="summary"
                variants={pageFade}
                initial="hidden"
                animate="visible"
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <button
                  type="button"
                  onClick={() => wizard.goToPassengerEntry()}
                  className="flex items-center gap-1.5 mb-4 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] cursor-pointer bg-transparent border-none hover:text-[var(--color-brand-navy)] transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Volver a pasajeros
                </button>

                <ReservationSummary
                  trip={locking.selectedTrip}
                  selectedSeats={locking.selectedSeats}
                  passengers={passengers}
                  bookerName={bookerName}
                  bookerDocument={bookerDocument}
                  onConfirm={handleConfirm}
                  submitting={submit.submitting}
                  submitError={submit.submitError}
                  onEditPassengers={handleEditPassengers}
                />
              </motion.div>
            )}

            {/* ─── success (post-redirect) ────────────────────────────── */}
            {reservationIdFromUrl && (
              <motion.div
                key="success"
                variants={pageFade}
                initial="hidden"
                animate="visible"
                transition={{ duration: 0.3 }}
              >
                <button
                  type="button"
                  onClick={() => router.push("/agency/reservations")}
                  className="flex items-center gap-1.5 mb-4 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] cursor-pointer bg-transparent border-none hover:text-[var(--color-brand-navy)] transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Volver a reservas
                </button>

                <div className="flex flex-col items-center text-center mb-6">
                  <div className="w-16 h-16 rounded-full bg-[#ecfdf5] flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-8 h-8 text-[#10b981]" />
                  </div>
                  <h2 className="font-[family-name:var(--font-heading)] font-bold text-xl text-[var(--color-brand-navy)] mb-1">
                    Reserva confirmada
                  </h2>
                  <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)] tracking-wider uppercase">
                    Código: {reservationIdFromUrl.slice(0, 8).toUpperCase()}
                  </p>
                </div>

                {successLoading && (
                  <div className="flex justify-center py-12">
                    <div className="w-8 h-8 border-2 border-[var(--color-brand-cyan)] border-t-transparent rounded-full animate-spin" />
                  </div>
                )}

                {successError && (
                  <div className="p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2] mb-6">
                    <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
                      {successError}
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => window.location.reload()}
                      className="mt-3"
                    >
                      Reintentar
                    </Button>
                  </div>
                )}

                {successData && (
                  <div className="max-w-[32rem] mx-auto">
                    <ReservationTicket ref={captureRef} reservation={successData} />
                    <div className="mt-4">
                      <ReservationTicketActions
                        reservationId={reservationIdFromUrl}
                        onDownload={download}
                        onShare={shareWithText}
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm mt-6 mx-auto">
                  <Button
                    variant="secondary"
                    onClick={() => router.push("/agency/reservations")}
                    className="flex-1"
                  >
                    Ver reservas
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleReset}
                    className="flex-1"
                  >
                    Nueva reserva
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </main>
  );
}
