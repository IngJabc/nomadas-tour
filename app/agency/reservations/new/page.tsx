'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Ticket, CheckCircle2, X } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { agencyApi } from '@/lib/api';
import { subscribeToTripSeats } from '@/lib/realtime/subscriptions';
import { Seat } from '@/types';
import { BusLayout } from '@/components/bus/BusLayout';
import { PassengerForm } from '@/components/booking/PassengerForm';
import { ReservationSummary } from '@/components/booking/ReservationSummary';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

type Step = 'select_trip' | 'select_seats' | 'passenger_form' | 'summary' | 'success';

interface PassengerData {
  seat_id: string;
  seat_code: string;
  name: string;
  document: string;
  phone: string;
}

type Toast = { id: number; message: string; type: 'error' | 'info' };

function validateForm(
  step: Step,
  trip: any | null,
  selectedSeats: Seat[],
  bookerName: string,
  bookerDocument: string,
  passengers: PassengerData[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (step === 'passenger_form' || step === 'summary') {
    if (!bookerName.trim()) errors.bookerName = 'El nombre del comprador es obligatorio';
    if (!bookerDocument.trim()) errors.bookerDocument = 'El documento es obligatorio';
    selectedSeats.forEach((seat, i) => {
      const p = passengers[i];
      if (!p || !p.name.trim()) errors[`passenger_${i}_name`] = 'Nombre requerido';
      if (!p || !p.document.trim()) errors[`passenger_${i}_document`] = 'Documento requerido';
    });
  }
  if (step === 'summary' && Object.keys(errors).length === 0) {
    if (!trip) errors._form = 'Viaje no encontrado';
    if (selectedSeats.length === 0) errors._form = 'Selecciona al menos un asiento';
  }
  return errors;
}

let toastId = 0;

export default function NewAgencyReservationPage() {
  return (
    <Suspense fallback={
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <CardSkeleton />
      </main>
    }>
      <NewReservationContent />
    </Suspense>
  );
}

function NewReservationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDeepLinkInitial = searchParams?.has('trip') ?? false;

  const [step, setStep] = useState<Step>(isDeepLinkInitial ? 'select_seats' : 'select_trip');
  const [isDeepLinkFlow, setIsDeepLinkFlow] = useState(isDeepLinkInitial);

  const [trips, setTrips] = useState<any[]>([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [tripsError, setTripsError] = useState<string | null>(null);

  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);
  const [tripLoading, setTripLoading] = useState(isDeepLinkInitial);

  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  const [seatsMap, setSeatsMap] = useState<Record<string, Seat>>({});

  const [bookerName, setBookerName] = useState('');
  const [bookerDocument, setBookerDocument] = useState('');

  const [passengers, setPassengers] = useState<PassengerData[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    reservation: any;
    passengers: any[];
    qr_code: string;
    qr_data_url: string;
  } | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [deepLinkError, setDeepLinkError] = useState(false);

  const tripIdRef = useRef<string | null>(null);
  const selectedSeatsRef = useRef<Seat[]>([]);
  const userIdRef = useRef<string | null>(null);
  const channelRef = useRef<any>(null);
  const tokenRef = useRef<string | null>(null);

  selectedSeatsRef.current = selectedSeats;
  userIdRef.current = userId;

  const addToast = useCallback((message: string, type: 'error' | 'info') => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const doUnlockAll = useCallback(async (tripId: string) => {
    if (!tripId) return;
    try {
      await agencyApi.unlockAllSeats(tripId);
    } catch { }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const tid = tripIdRef.current;
      if (tid) { doUnlockAll(tid); }
      if (channelRef.current) { channelRef.current.unsubscribe(); }
    };
  }, [doUnlockAll]);

  // Store auth token for unload handler
  useEffect(() => {
    (async () => {
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        tokenRef.current = session?.access_token ?? null;
        setUserId(session?.user?.id ?? null);
      } catch { }
    })();
  }, []);

  // beforeunload / pagehide / visibilitychange
  useEffect(() => {
    const handleUnload = () => {
      const tid = tripIdRef.current;
      const token = tokenRef.current;
      if (tid && token) {
        try {
          fetch(
            `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/agency/seats/unlock-all`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ trip_id: tid }),
              keepalive: true,
            },
          );
        } catch { }
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') handleUnload();
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Load trips
  useEffect(() => {
    async function load() {
      try {
        const data = await agencyApi.listTrips();
        setTrips(data || []);
      } catch (err) {
        setTripsError(err instanceof Error ? err.message : 'Error al cargar viajes');
      } finally {
        setTripsLoading(false);
      }
    }
    load();
  }, []);

  // Realtime: actualizar disponibilidad en selector de viajes
  useEffect(() => {
    if (step !== 'select_trip' || trips.length === 0) return;

    const tripIds = trips.map((t: any) => t.id);

    const cleanup = subscribeToTripSeats(tripIds, (seat) => {
      const tripId = seat.trip_id as string;
      if (!tripId) return;

      agencyApi.getTrip(tripId).then((fresh) => {
        const seats = fresh.seats ?? [];
        const available_seats = seats.filter((s: any) => s.status === 'available').length;
        const reserved_seats = seats.filter((s: any) => s.status === 'reserved' || s.status === 'boarded').length;

        setTrips((prev) => {
          const idx = prev.findIndex((t: any) => t.id === tripId);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = { ...updated[idx], available_seats, reserved_seats };
          return updated;
        });
      }).catch(() => {});
    });

    return () => {
      cleanup();
    };
  }, [step, trips.length]);

  // Load trip with seats
  const loadTrip = useCallback(async (tripId: string) => {
    // Unlock previous trip seats
    const prevId = tripIdRef.current;
    if (prevId && prevId !== tripId) {
      await doUnlockAll(prevId);
    }
    if (channelRef.current) { channelRef.current.unsubscribe(); channelRef.current = null; }

    setTripLoading(true);
    setSelectedSeats([]);
    setBookerName('');
    setBookerDocument('');
    setPassengers([]);
    setErrors({});
    try {
      const trip = await agencyApi.getTrip(tripId);
      setSelectedTrip(trip);
      const map: Record<string, Seat> = {};
      (trip.seats || []).forEach((s: Seat) => { map[s.seat_code] = s; });
      setSeatsMap(map);
      tripIdRef.current = tripId;
      setStep('select_seats');
    } catch (err) {
      setTripsError(err instanceof Error ? err.message : 'Error al cargar el viaje');
    } finally {
      setTripLoading(false);
    }
  }, [doUnlockAll]);

  // Deep link: auto-load trip from ?trip= param
  const loadDeepLinkTrip = useCallback(async (tripId: string) => {
    const prevId = tripIdRef.current;
    if (prevId && prevId !== tripId) {
      await doUnlockAll(prevId);
    }
    if (channelRef.current) { channelRef.current.unsubscribe(); channelRef.current = null; }

    setTripLoading(true);
    try {
      const trip = await agencyApi.getTrip(tripId);
      if (!trip || trip.status === 'completed') {
        setDeepLinkError(true);
        return;
      }
      setSelectedTrip(trip);
      const map: Record<string, Seat> = {};
      (trip.seats || []).forEach((s: Seat) => { map[s.seat_code] = s; });
      setSeatsMap(map);
      tripIdRef.current = tripId;
      setStep('select_seats');
    } catch {
      setDeepLinkError(true);
    } finally {
      setTripLoading(false);
    }
  }, [doUnlockAll]);

  const tripIdParam = searchParams?.get('trip') ?? null;

  useEffect(() => {
    if (tripIdParam) {
      loadDeepLinkTrip(tripIdParam);
    }
  }, [loadDeepLinkTrip, tripIdParam]);

  // Realtime subscription for seats
  useEffect(() => {
    if (!tripIdRef.current || step !== 'select_seats') return;
    const tripId = tripIdRef.current;

    const setupChannel = async () => {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();

      if (channelRef.current) { channelRef.current.unsubscribe(); }

      const channel = supabase
        .channel(`seats-${tripId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'seats', filter: `trip_id=eq.${tripId}` },
          (payload) => {
            const newSeat = payload.new as any;
            if (!newSeat || !newSeat.seat_code) return;
            const currentUserId = userIdRef.current;
            setSeatsMap((prev) => {
              const existing = prev[newSeat.seat_code];
              if (!existing) return prev;

              if (newSeat.status === 'locked' && newSeat.locked_by !== existing.locked_by && newSeat.locked_by !== currentUserId) {
                setSelectedSeats((sel) => sel.filter((s) => s.id !== newSeat.id));
              }

              return { ...prev, [newSeat.seat_code]: { ...existing, ...newSeat } };
            });
          }
        )
        .subscribe();

      channelRef.current = channel;
    };

    setupChannel();

    return () => {
      if (channelRef.current) { channelRef.current.unsubscribe(); channelRef.current = null; }
    };
  }, [step, selectedTrip?.id]);



  const handleToggleSeat = async (seat: Seat) => {
    if (seat.status === 'reserved') return;
    if (seat.status === 'locked' && seat.locked_by !== userId) return;

    const exists = selectedSeats.some((s) => s.id === seat.id);
    if (exists) {
      try {
        await agencyApi.unlockSeat(selectedTrip!.id, seat.id);
        setSelectedSeats((prev) => prev.filter((s) => s.id !== seat.id));
      } catch {
        addToast('No se pudo liberar el asiento', 'error');
      }
    } else {
      try {
        await agencyApi.lockSeat(selectedTrip!.id, seat.id);
        setSelectedSeats((prev) => [...prev, seat]);
      } catch {
        addToast('Asiento ocupado por otro usuario', 'error');
      }
    }
  };

  const handleProceedToForm = () => {
    if (selectedSeats.length === 0) return;
    const sorted = [...selectedSeats].sort((a, b) => {
      const numA = parseInt(a.seat_code.slice(1), 10);
      const numB = parseInt(b.seat_code.slice(1), 10);
      return numA - numB;
    });
    setSelectedSeats(sorted);
    const initial = sorted.map((s) => ({
      seat_id: s.id,
      seat_code: s.seat_code,
      name: '',
      document: '',
      phone: '',
    }));
    setPassengers(initial);
    setErrors({});
    setStep('passenger_form');
  };

  const handleBookerChange = (name: string, document: string) => {
    setBookerName(name);
    setBookerDocument(document);
  };

  const handlePassengerChange = (index: number, field: keyof PassengerData, value: string) => {
    setPassengers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleProceedToSummary = () => {
    const err = validateForm('passenger_form', selectedTrip, selectedSeats, bookerName, bookerDocument, passengers);
    setErrors(err);
    if (Object.keys(err).length > 0) return;
    setStep('summary');
  };

  const handleConfirm = async () => {
    const err = validateForm('summary', selectedTrip, selectedSeats, bookerName, bookerDocument, passengers);
    setErrors(err);
    if (Object.keys(err).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        trip_id: selectedTrip!.id,
        booker_name: bookerName.trim(),
        booker_document: bookerDocument.trim(),
        booker_phone: '',
        passengers: selectedSeats.map((s) => {
          const p = passengers.find((p) => p.seat_id === s.id)!;
          return {
            seat_id: s.id,
            name: p.name.trim(),
            document: p.document.trim(),
            phone: p.phone.trim() || undefined,
          };
        }),
      };
      const res = await agencyApi.createReservation(payload);
      setResult(res);
      setStep('success');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Error al crear la reserva');
    } finally {
      setSubmitting(false);
    }
  };

  // Clean up locks after success
  useEffect(() => {
    if (step === 'success' && tripIdRef.current) {
      tripIdRef.current = null;
    }
  }, [step]);

  const renderSelectTrip = () => (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-1 h-[22px] bg-[var(--color-brand-cyan)] rounded-sm" />
        <h2 className="font-[family-name:var(--font-heading)] font-bold text-xl text-[var(--color-brand-navy)]">
          Nueva reserva
        </h2>
      </div>

      {tripsLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : tripsError ? (
        <div className="p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2] font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
          {tripsError}
        </div>
      ) : (
        (() => {
          const availableTrips = trips.filter((t: any) => t.status === 'active' && t.available_seats > 0);
          if (availableTrips.length === 0) {
            return (
              <EmptyState
                icon={<Ticket className="w-8 h-8" />}
                message={trips.length === 0 ? 'No hay viajes disponibles para tu agencia' : 'No hay viajes activos con asientos disponibles'}
                action={{ label: 'Regresar', onClick: () => router.push('/agency') }}
              />
            );
          }
          return (
        <div className="space-y-3">
          {availableTrips.map((trip: any) => (
              <button
                key={trip.id}
                type="button"
                onClick={() => loadTrip(trip.id)}
                className="w-full text-left bg-[var(--color-brand-surface)] rounded-2xl p-5 border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] cursor-pointer transition-all duration-200 hover:shadow-[0_6px_24px_rgba(0,212,255,0.12)] hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]">
                      {trip.route?.origin ?? 'Origen'} → {trip.route?.destination ?? 'Destino'}
                    </p>
                    <p className="font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-muted)] mt-1">
                      {trip.departure_time
                        ? format(new Date(trip.departure_time), "d 'de' MMMM yyyy, HH:mm", { locale: es })
                        : ''}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-[family-name:var(--font-body)] font-bold text-lg text-[var(--color-brand-cyan)]">
                        {trip.available_seats}
                      </p>
                      <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] whitespace-nowrap">
                        disponibles
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-[var(--color-brand-muted)]" />
                  </div>
                </div>
              </button>
            ))}
        </div>
      );
      })()
      )}
    </div>
  );

  const renderSelectSeats = () => (
    <div>
      {!isDeepLinkFlow && (
        <button
          type="button"
          onClick={async () => {
            if (tripIdRef.current) await doUnlockAll(tripIdRef.current);
            setStep('select_trip');
          }}
          className="flex items-center gap-1.5 mb-4 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] cursor-pointer bg-transparent border-none hover:text-[var(--color-brand-navy)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a viajes
        </button>
      )}

      {tripLoading ? (
        <div className="flex items-center justify-center py-20">
          <svg className="animate-spin h-8 w-8 text-[var(--color-brand-cyan)]" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : !selectedTrip ? (
        <div className="p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2] font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
          No se pudo cargar el viaje
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-1 h-[18px] bg-[var(--color-brand-cyan)] rounded-sm" />
            <div>
              <h2 className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]">
                {selectedTrip.routes?.origin ?? ''} → {selectedTrip.routes?.destination ?? ''}
              </h2>
              <p className="font-[family-name:var(--font-body)] font-normal text-[13px] text-[var(--color-brand-muted)]">
                {selectedTrip.departure_time
                  ? format(new Date(selectedTrip.departure_time), "d 'de' MMMM, HH:mm", { locale: es })
                  : ''}
              </p>
            </div>
          </div>

          <BusLayout
            seats={seatsMap}
            selectedSeats={selectedSeats}
            onToggleSeat={handleToggleSeat}
            vehicleType={selectedTrip.vehicle_type ?? 'bus'}
            userId={userId}
          />

          <div className="flex items-center justify-between mt-6">
            <div>
              <span className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)]">
                {selectedSeats.length} asiento{selectedSeats.length !== 1 ? 's' : ''} seleccionado{selectedSeats.length !== 1 ? 's' : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={handleProceedToForm}
              disabled={selectedSeats.length === 0}
              className="px-6 py-2.5 bg-[var(--color-brand-cyan)] text-white font-[family-name:var(--font-body)] font-semibold text-sm rounded-xl border-none cursor-pointer transition-all duration-200 hover:bg-[var(--color-brand-blue)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              Continuar
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );

  const renderPassengerForm = () => (
    <div>
      <button
        type="button"
        onClick={() => setStep('select_seats')}
        className="flex items-center gap-1.5 mb-4 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] cursor-pointer bg-transparent border-none hover:text-[var(--color-brand-navy)] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver a asientos
      </button>

      <PassengerForm
        selectedSeats={selectedSeats}
        bookerName={bookerName}
        bookerDocument={bookerDocument}
        onBookerChange={handleBookerChange}
        passengers={passengers}
        onPassengerChange={handlePassengerChange}
        errors={errors}
      />

      <div className="flex justify-end mt-6">
        <button
          type="button"
          onClick={handleProceedToSummary}
          className="px-6 py-2.5 bg-[var(--color-brand-cyan)] text-white font-[family-name:var(--font-body)] font-semibold text-sm rounded-xl border-none cursor-pointer transition-all duration-200 hover:bg-[var(--color-brand-blue)] flex items-center gap-2"
        >
          Revisar reserva
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  const renderSummary = () => (
    <div>
      <button
        type="button"
        onClick={() => setStep('passenger_form')}
        className="flex items-center gap-1.5 mb-4 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] cursor-pointer bg-transparent border-none hover:text-[var(--color-brand-navy)] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver a datos
      </button>

      <ReservationSummary
        trip={selectedTrip}
        selectedSeats={selectedSeats}
        passengers={passengers}
        bookerName={bookerName}
        bookerDocument={bookerDocument}
        onConfirm={handleConfirm}
        loading={submitting}
        error={submitError}
      />
    </div>
  );

  const renderSuccess = () => (
    <div className="flex flex-col items-center text-center py-8">
      <div className="w-16 h-16 rounded-full bg-[#ecfdf5] flex items-center justify-center mb-4">
        <CheckCircle2 className="w-8 h-8 text-[#10b981]" />
      </div>

      <h2 className="font-[family-name:var(--font-heading)] font-bold text-xl text-[var(--color-brand-navy)] mb-2">
        Reserva confirmada
      </h2>
      <p className="font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-muted)] mb-6 max-w-sm">
        {selectedTrip?.routes?.origin ?? ''} → {selectedTrip?.routes?.destination ?? ''}
        <br />
        {selectedTrip?.departure_time
          ? format(new Date(selectedTrip.departure_time), "d 'de' MMMM yyyy, HH:mm", { locale: es })
          : ''}
      </p>

      {result?.qr_data_url && (
        <div className="bg-white rounded-2xl p-4 border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.qr_data_url}
            alt="Código QR de la reserva"
            className="w-48 h-48"
          />
        </div>
      )}

      <div className="bg-[var(--color-page-bg)] rounded-2xl p-5 border border-[rgba(0,0,0,0.06)] w-full max-w-sm mb-6">
        <p className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-navy)] mb-3">
          Pasajeros
        </p>
        <div className="space-y-2">
          {passengers.map((p, i) => (
            <div key={p.seat_id} className="flex items-center gap-3 text-sm">
              <span className="font-[family-name:var(--font-body)] font-bold text-[13px] text-[var(--color-brand-cyan)] bg-[rgba(0,212,255,0.1)] px-2 py-0.5 rounded-md min-w-[36px] text-center">
                {p.seat_code}
              </span>
              <span className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)]">{p.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => router.push('/agency/reservations')}
          className="px-6 py-2.5 bg-[#f1f5f9] text-[var(--color-brand-navy)] font-[family-name:var(--font-body)] font-semibold text-sm rounded-xl border-none cursor-pointer transition-all duration-200 hover:bg-[#e2e8f0]"
        >
          Ver reservas
        </button>
        <button
          type="button"
          onClick={() => {
            setStep('select_trip');
            setSelectedTrip(null);
            setSelectedSeats([]);
            setBookerName('');
            setBookerDocument('');
            setPassengers([]);
            setErrors({});
            setSubmitError(null);
            setResult(null);
          }}
          className="px-6 py-2.5 bg-[var(--color-brand-cyan)] text-white font-[family-name:var(--font-body)] font-semibold text-sm rounded-xl border-none cursor-pointer transition-all duration-200 hover:bg-[var(--color-brand-blue)]"
        >
          Nueva reserva
        </button>
      </div>
    </div>
  );

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 space-y-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg font-[family-name:var(--font-body)] font-medium text-sm text-white ${
                t.type === 'error' ? 'bg-[#ef4444]' : 'bg-[var(--color-brand-navy)]'
              }`}
            >
              <span>{t.message}</span>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="ml-1 p-0.5 rounded hover:bg-white/20"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {deepLinkError && (
        <div className="flex items-center justify-center py-20">
          <EmptyState
            icon={<Ticket className="w-8 h-8" />}
            message="Este viaje ya no está disponible. El viaje ya no existe, fue finalizado o no pertenece a tu agencia."
            action={{ label: 'Volver a Mis Viajes', href: '/agency/trips' }}
          />
        </div>
      )}

      {!deepLinkError && step !== 'success' && (
        <div className="flex items-center gap-1.5 mb-8">
          {[
            { key: 'select_trip', label: 'Viaje' },
            { key: 'select_seats', label: 'Asientos' },
            { key: 'passenger_form', label: 'Pasajeros' },
            { key: 'summary', label: 'Resumen' },
          ].map((s, i) => {
            const steps = ['select_trip', 'select_seats', 'passenger_form', 'summary'];
            const currentIdx = steps.indexOf(step);
            const stepIdx = steps.indexOf(s.key);
            const done = stepIdx < currentIdx;
            const active = step === s.key;
            return (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold font-[family-name:var(--font-body)] transition-all ${
                    done
                      ? 'bg-[var(--color-brand-cyan)] text-white'
                      : active
                      ? 'bg-[var(--color-brand-cyan)] text-white'
                      : 'bg-[#e5e7eb] text-[var(--color-brand-muted)]'
                  }`}
                >
                  {i + 1}
                </span>
                <span
                  className={`font-[family-name:var(--font-body)] font-medium text-xs ${
                    active || done ? 'text-[var(--color-brand-navy)]' : 'text-[var(--color-brand-muted)]'
                  } hidden sm:inline`}
                >
                  {s.label}
                </span>
                {i < 3 && (
                  <div className={`w-5 h-px mx-1 ${stepIdx < currentIdx ? 'bg-[var(--color-brand-cyan)]' : 'bg-[#e5e7eb]'}`} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {!deepLinkError && (
        <div className="bg-[var(--color-brand-surface)] rounded-2xl p-6 border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          {step === 'select_trip' && renderSelectTrip()}
          {step === 'select_seats' && renderSelectSeats()}
          {step === 'passenger_form' && renderPassengerForm()}
          {step === 'summary' && renderSummary()}
          {step === 'success' && renderSuccess()}
        </div>
      )}
    </main>
  );
}
