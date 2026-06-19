'use client';

import { useState } from 'react';
import { useRealtimeSeats } from '@/hooks/useRealtimeSeats';
import { BusLayout } from '@/components/bus/BusLayout';
import { SeatLegend } from '@/components/bus/SeatLegend';
import { BookingPanel } from '@/components/booking/BookingPanel';
import { Seat } from '@/types';

interface TripClientProps {
  tripId: string;
  price: number;
}

export function TripClient({ tripId, price }: TripClientProps) {
  const { seats, loading } = useRealtimeSeats(tripId);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  const [success, setSuccess] = useState(false);

  const toggleSeat = (seat: Seat) => {
    if (seat.status !== 'available') return;

    setSelectedSeats((prev) => {
      const exists = prev.find((s) => s.id === seat.id);
      if (exists) {
        return prev.filter((s) => s.id !== seat.id);
      }
      return [...prev, seat];
    });
  };

  const isSelected = (seatId: string) => {
    return selectedSeats.some((s) => s.id === seatId);
  };

  const handleSuccess = () => {
    setSuccess(true);
    setSelectedSeats([]);
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
        <div className="bg-green-100 text-green-700 rounded-xl p-8 inline-block">
          <h2 className="text-2xl font-bold mb-2">¡Reserva confirmada!</h2>
          <p>Revisa tus reservas en el dashboard</p>
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
