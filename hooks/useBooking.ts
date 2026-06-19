'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Seat } from '@/types';

export function useBooking(tripId: string) {
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const toggleSeat = (seat: Seat): boolean => {
    if (seat.status !== 'available') return false;

    const isSelected = selectedSeats.some((s) => s.id === seat.id);
    if (isSelected) {
      setSelectedSeats((prev) => prev.filter((s) => s.id !== seat.id));
    } else {
      setSelectedSeats((prev) => [...prev, seat]);
    }
    return true;
  };

  const isSelected = (seatId: string): boolean => {
    return selectedSeats.some((s) => s.id === seatId);
  };

  const confirmBooking = async (
    passengerName: string,
    passengerEmail: string,
  ) => {
    setLoading(true);
    setError(null);

    try {
      const { data: user } = await supabase.auth.getUser();

      for (const seat of selectedSeats) {
        const qrCode = `CAMPING-${Date.now()}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

        const { error: bookingError } = await supabase.from('bookings').insert({
          user_id: user.user?.id ?? null,
          trip_id: tripId,
          seat_id: seat.id,
          passenger_name: passengerName,
          passenger_email: passengerEmail,
          qr_code: qrCode,
          status: 'confirmed',
        });

        if (bookingError) throw bookingError;

        await supabase
          .from('seats')
          .update({ status: 'reserved', locked_by: null, locked_at: null })
          .eq('id', seat.id);
      }

      setSelectedSeats([]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al confirmar reserva');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const clearSelection = () => {
    setSelectedSeats([]);
  };

  return {
    selectedSeats,
    loading,
    error,
    toggleSeat,
    isSelected,
    confirmBooking,
    clearSelection,
    totalPrice: 0,
  };
}
