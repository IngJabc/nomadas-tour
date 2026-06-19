'use client';

import { useState } from 'react';
import { Seat } from '@/types';
import { formatPrice, generateQRCode } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

interface BookingPanelProps {
  selectedSeats: Seat[];
  tripId: string;
  price: number;
  onSuccess: () => void;
  onClear: () => void;
}

export function BookingPanel({
  selectedSeats,
  tripId,
  price,
  onSuccess,
  onClear,
}: BookingPanelProps) {
  const [passengerName, setPassengerName] = useState('');
  const [passengerEmail, setPassengerEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const total = selectedSeats.length * price;

  const handleConfirm = async () => {
    if (!passengerName.trim() || !passengerEmail.trim()) {
      setError('Complete todos los campos');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: user } = await supabase.auth.getUser();

      for (const seat of selectedSeats) {
        const qrCode = generateQRCode();

        const { error: bookingError } = await supabase.from('bookings').insert({
          user_id: user.user?.id ?? null,
          trip_id: tripId,
          seat_id: seat.id,
          passenger_name: passengerName.trim(),
          passenger_email: passengerEmail.trim(),
          qr_code: qrCode,
          status: 'confirmed',
        });

        if (bookingError) throw bookingError;

        const { error: updateError } = await supabase
          .from('seats')
          .update({ status: 'reserved', locked_by: null, locked_at: null })
          .eq('id', seat.id);

        if (updateError) throw updateError;
      }

      onSuccess();
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
