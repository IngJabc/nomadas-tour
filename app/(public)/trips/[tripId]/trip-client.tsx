'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRealtimeSeats } from '@/hooks/useRealtimeSeats';
import { BusLayout } from '@/components/bus/BusLayout';
import { SeatLegend } from '@/components/bus/SeatLegend';
import { BookingPanel } from '@/components/booking/BookingPanel';
import { createClient } from '@/lib/supabase/client';
import { Seat } from '@/types';

interface TripClientProps {
  tripId: string;
  price: number;
  totalSeats: number;
}

export function TripClient({ tripId, price, totalSeats }: TripClientProps) {
  const { seats, loading } = useRealtimeSeats(tripId);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  const [success, setSuccess] = useState(false);
  const [lastBookingId, setLastBookingId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const myLocalLocks = useRef<Set<string>>(new Set());
  const selectedSeatsRef = useRef<Seat[]>([]);
  const clearedSeatsRef = useRef<Set<string>>(new Set());
  const supabase = createClient();

  // Keep ref in sync with state (avoids stale closure in async handlers)
  useEffect(() => {
    selectedSeatsRef.current = selectedSeats;
  }, [selectedSeats]);

  // Cleanup: remove from selection only seats reserved by others or locked by others
  useEffect(() => {
    const getUserId = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id;

      setSelectedSeats((prev) =>
        prev.filter((s) => {
          const updated = seats[s.seat_code];
          if (!updated) return true;
          // Keep if still available
          if (updated.status === 'available') return true;
          // Keep if locked by the current user (they can still deselect it)
          if (updated.status === 'locked' && updated.locked_by === currentUserId) return true;
          // Remove if reserved (someone else confirmed) or locked by another user
          return false;
        }),
      );
    };
    getUserId();
  }, [seats, supabase]);

  // Track current user id
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!mounted) return;
        setUserId(data.user?.id ?? null);
      } catch {
        setUserId(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  // Reconcile selection with server state and restore locks after reload
  useEffect(() => {
    if (!userId) return;

    // Clean up cleared seats tracking once Realtime confirms they're no longer locked
    if (clearedSeatsRef.current.size > 0) {
      for (const seatCode of clearedSeatsRef.current) {
        const live = seats[seatCode];
        if (live && live.status !== 'locked') {
          clearedSeatsRef.current.delete(seatCode);
        }
      }
    }

    setSelectedSeats((prev) => {
      const filtered = prev.filter((s) => {
        const live = seats[s.seat_code];
        if (!live) return false;
        if (live.status === 'available') {
          // Stop tracking cleared seats once Realtime confirms they're available
          clearedSeatsRef.current.delete(s.seat_code);
          // Only keep if optimistically selected (lock not yet confirmed by Realtime)
          return myLocalLocks.current.has(s.id);
        }
        if (live.status === 'reserved') return false;
        if (live.status === 'locked') {
          if (live.locked_by) {
            return live.locked_by === userId;
          }
          return myLocalLocks.current.has(s.id);
        }
        return false;
      });

      // Restore seats locked by current user (e.g. after page reload)
      // Skip seats that were explicitly cleared by Cancelar
      const existingCodes = new Set(filtered.map((s) => s.seat_code));
      const restored = Object.values(seats).filter(
        (s) =>
          s.status === 'locked' &&
          s.locked_by === userId &&
          !existingCodes.has(s.seat_code) &&
          !clearedSeatsRef.current.has(s.seat_code),
      );

      if (restored.length === 0) return filtered;
      // Track restored seats so future Realtime updates don't remove them
      restored.forEach((s) => myLocalLocks.current.add(s.id));
      return [...filtered, ...restored];
    });
  }, [seats, userId]);

  const releaseLocks = async (seatIds: string[]): Promise<void> => {
    if (seatIds.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('seats')
      .update({ status: 'available', locked_by: null, locked_at: null })
      .in('id', seatIds)
      .eq('locked_by', user.id);
  };

  const toggleSeat = async (seat: Seat) => {
    // Guard against placeholder seats with empty id (Bug #6)
    if (!seat.id) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const isDeselecting = selectedSeats.some((s) => s.seat_code === seat.seat_code);

    if (isDeselecting) {
      setSelectedSeats((prev) => prev.filter((s) => s.seat_code !== seat.seat_code));
      myLocalLocks.current.delete(seat.id);
      await releaseLocks([seat.id]);
      return;
    }

    if (seat.status !== 'available') return;

    // Optimistic select with dedup guard (Bug #4: double-click)
    setSelectedSeats((prev) => {
      if (prev.some((s) => s.seat_code === seat.seat_code)) return prev;
      return [...prev, seat];
    });
    myLocalLocks.current.add(seat.id);

    // Try to acquire lock atomically (only if status still 'available')
    const { data: updatedRows, error: updateError } = await supabase
      .from('seats')
      .update({ status: 'locked', locked_by: user.id, locked_at: new Date().toISOString() })
      .eq('id', seat.id)
      .eq('status', 'available')
      .select();

    // Revert optimistic selection if lock acquisition failed
    if (updateError || !updatedRows || updatedRows.length === 0) {
      myLocalLocks.current.delete(seat.id);
      setSelectedSeats((prev) => prev.filter((s) => s.seat_code !== seat.seat_code));
    }
  };

  const handleSuccess = (bookingIds: string[]) => {
    setSuccess(true);
    myLocalLocks.current = new Set();  // Bug #8: cleanup refs
    clearedSeatsRef.current = new Set();
    setSelectedSeats([]);
    if (bookingIds.length > 0) {
      setLastBookingId(bookingIds[0]);
    }
  };

  const handleClear = async () => {
    const seatsToRelease = selectedSeatsRef.current;
    if (seatsToRelease.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSelectedSeats([]);
      return;
    }
    // Track which seats were cleared so restore doesn't re-add them
    seatsToRelease.forEach((s) => clearedSeatsRef.current.add(s.seat_code));
    const seatIds = seatsToRelease.map((s) => s.id);
    myLocalLocks.current = new Set();
    setSelectedSeats([]);
    await supabase
      .from('seats')
      .update({ status: 'available', locked_by: null, locked_at: null })
      .in('id', seatIds)
      .eq('locked_by', user.id);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="text-center py-12">
        <div className="bg-green-100 text-green-700 rounded-xl p-8 inline-block max-w-md">
          <h2 className="text-2xl font-bold mb-2">¡Reserva confirmada!</h2>
          <p className="mb-6">Tu(s) asiento(s) han sido reservados exitosamente</p>
          <div className="flex gap-3 justify-center">
            {lastBookingId && (
              <Link
                href={`/bookings/${lastBookingId}`}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Ver mi boleto
              </Link>
            )}
            <Link
              href="/dashboard"
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Mis reservas
            </Link>
            <Link
              href="/"
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Ver más viajes
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      <div className="flex flex-col items-center gap-6">
        <BusLayout
          seats={seats}
          selectedSeats={selectedSeats}
          onToggleSeat={toggleSeat}
          totalSeats={totalSeats}
        />
        <SeatLegend />
      </div>
      <div className="w-full lg:w-80 sticky top-8">
        <BookingPanel
          selectedSeats={selectedSeats}
          tripId={tripId}
          price={price}
          onSuccess={handleSuccess}
          onClear={handleClear}
          onReleaseLocks={releaseLocks}
        />
      </div>
    </div>
  );
}
