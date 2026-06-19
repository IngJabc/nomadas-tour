'use client';

import { useState } from 'react';
import { Seat } from '@/types';
import { formatPrice } from '@/lib/utils';

interface BookingPanelProps {
  selectedSeats: Seat[];
  tripId: string;
  price: number;
  onSuccess: (bookingIds: string[]) => void;
  onClear: () => void;
  onReleaseLocks?: (seatIds: string[]) => Promise<void>;
}

export function BookingPanel({
  selectedSeats,
  tripId,
  price,
  onSuccess,
  onClear,
  onReleaseLocks,
}: BookingPanelProps) {
  const [passengerName, setPassengerName] = useState('');
  const [passengerEmail, setPassengerEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = selectedSeats.length * price;

  const handleConfirm = async () => {
    if (!passengerName.trim() || !passengerEmail.trim()) {
      setError('Complete todos los campos');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const bookingIds: string[] = [];
      let failed = false;

      for (const seat of selectedSeats) {
        if (failed) break;
        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trip_id: tripId,
            seat_id: seat.id,
            passenger_name: passengerName.trim(),
            passenger_email: passengerEmail.trim(),
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          // Release remaining locks (Bug #3: orphaned locks)
          const remainingSeats = selectedSeats
            .filter((s) => s.seat_code !== seat.seat_code)
            .map((s) => s.id);
          if (remainingSeats.length > 0 && onReleaseLocks) {
            await onReleaseLocks(remainingSeats);
          }
          throw new Error(
            `Asiento ${seat.seat_code}: ${data.error || 'Error al confirmar reserva'}`,
          );
        }

        if (data.booking?.id) {
          bookingIds.push(data.booking.id);
        }
      }

      onSuccess(bookingIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al confirmar reserva');
    } finally {
      setLoading(false);
    }
  };

  if (selectedSeats.length === 0) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-md">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Tu reserva</h3>
        <p className="text-gray-500">Selecciona uno o más asientos del bus</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-6 shadow-md">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Resumen de reserva</h3>

      <div className="space-y-2 mb-4">
        <p className="text-sm text-gray-600">
          Asientos: {selectedSeats.map((s) => s.seat_code).join(', ')}
        </p>
        <p className="text-sm text-gray-600">
          Cantidad: {selectedSeats.length}
        </p>
        <p className="text-lg font-bold text-gray-800">
          Total: {formatPrice(total)}
        </p>
      </div>

      <div className="space-y-3">
        <input
          type="text"
          placeholder="Nombre del pasajero"
          value={passengerName}
          onChange={(e) => setPassengerName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="email"
          placeholder="Email del pasajero"
          value={passengerEmail}
          onChange={(e) => setPassengerEmail(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && (
        <p className="text-red-500 text-sm mt-2">{error}</p>
      )}

      <div className="flex gap-2 mt-4">
        <button
          type="button"
          onClick={onClear}
          disabled={loading}
          className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={loading}
          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Reservando...' : 'Confirmar reserva'}
        </button>
      </div>
    </div>
  );
}
