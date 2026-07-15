'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { agencyApi } from '@/lib/api';
import { Seat, Trip, PassengerData, ReservationPayload, ReservationResult } from '@/types';

interface UseReservationSubmitOptions {
  trip: Trip | null;
  selectedSeats: Seat[];
  bookerName: string;
  bookerDocument: string;
  passengers: PassengerData[];
  onSuccess: () => void;
}

interface UseReservationSubmitReturn {
  submitting: boolean;
  submitError: string | null;
  result: ReservationResult | null;
  submit: () => Promise<void>;
  clearError: () => void;
  resetResult: () => void;
}

export function useReservationSubmit({
  trip,
  selectedSeats,
  bookerName,
  bookerDocument,
  passengers,
  onSuccess,
}: UseReservationSubmitOptions): UseReservationSubmitReturn {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<ReservationResult | null>(null);
  const submittingRef = useRef(false);

  // Build passenger lookup map for O(1) access
  const passengerMap = useMemo(() => {
    const map = new Map<string, PassengerData>();
    for (const p of passengers) map.set(p.seat_id, p);
    return map;
  }, [passengers]);

  const clearError = useCallback(() => setSubmitError(null), []);

  const resetResult = useCallback(() => setResult(null), []);

  const submit = useCallback(async () => {
    if (submittingRef.current) return; // double submit protection
    if (!trip || selectedSeats.length === 0) return;

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: ReservationPayload = {
        trip_id: trip.id,
        booker_name: bookerName.trim(),
        booker_document: bookerDocument.trim(),
        booker_phone: '',
        passengers: selectedSeats.map((s) => {
          const p = passengerMap.get(s.id);
          if (!p) throw new Error(`Datos del pasajero para asiento ${s.seat_code} no encontrados`);
          return {
            seat_id: s.id,
            name: p.name.trim(),
            document: p.document.trim(),
            phone: p.phone.trim() || undefined,
          };
        }),
      };
      const res: ReservationResult = await agencyApi.createReservation(payload);
      setResult(res);
      onSuccess();
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message.includes("409") || err.message.toLowerCase().includes("conflict") || err.message.toLowerCase().includes("already reserved")
            ? "Uno o más asientos ya no están disponibles. Regresa y selecciona nuevamente."
            : err.message.includes("lock") || err.message.toLowerCase().includes("expir")
            ? "Tus asientos expiraron. Regresa y selecciona nuevamente."
            : err.message
          : "Error al crear la reserva"
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [trip, selectedSeats, bookerName, bookerDocument, passengerMap, onSuccess]);

  return {
    submitting,
    submitError,
    result,
    submit,
    clearError,
    resetResult,
  };
}
