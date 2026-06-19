'use client';

import { useEffect, useState } from 'react';
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
  const supabase = createClient();

  // Cleanup: when Realtime updates a seat to reserved/locked, remove from selection
  useEffect(() => {
    setSelectedSeats((prev) =>
      prev.filter((s) => seats[s.seat_code]?.status === 'available'),
    );
  }, [seats]);

  const toggleSeat = async (seat: Seat) => {
    if (seat.status !== 'available') return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setSelectedSeats((prev) => {
      const isDeselecting = prev.some((s) => s.id === seat.id);

      if (isDeselecting) {
        supabase
          .from('seats')
          .update({ status: 'available', locked_by: null, locked_at: null })
          .eq('id', seat.id)
          .eq('locked_by', user.id)
          .then();
        return prev.filter((s) => s.id !== seat.id);
      }

      supabase
        .from('seats')
        .update({ status: 'locked', locked_by: user.id, locked_at: new Date().toISOString() })
        .eq('id', seat.id)
        .eq('status', 'available')
        .then(({ error }) => {
          if (error) {
            setSelectedSeats((p) => p.filter((s) => s.id !== seat.id));
          }
        });

      return [...prev, seat];
    });
  };

  const isSelected = (seatId: string) => {
    return selectedSeats.some((s) => s.id === seatId);
  };

  const handleSuccess = (bookingIds: string[]) => {
    setSuccess(true);
    setSelectedSeats([]);
    if (bookingIds.length > 0) {
      setLastBookingId(bookingIds[0]);
    }
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
          isSelected={isSelected}
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
          onClear={() => setSelectedSeats([])}
        />
      </div>
    </div>
  );
}
