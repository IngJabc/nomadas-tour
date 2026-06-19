'use client';

import { QRCode } from 'react-qr-code';
import { Booking } from '@/types';
import { formatDateTime, formatPrice } from '@/lib/utils';

interface QRTicketProps {
  booking: Booking;
}

export function QRTicket({ booking }: QRTicketProps) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-md border-2 border-gray-200 max-w-sm mx-auto">
      <div className="text-center mb-4">
        <h3 className="font-bold text-lg text-gray-800">Camping Cascada del Vino</h3>
        <p className="text-sm text-gray-500">Boleto de viaje</p>
      </div>

      <div className="flex justify-center mb-4">
        <QRCode value={booking.qr_code} size={180} />
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Código:</span>
          <span className="font-mono font-bold">{booking.qr_code.slice(0, 15)}...</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Pasajero:</span>
          <span className="font-medium">{booking.passenger_name}</span>
        </div>
        {booking.trip && (
          <>
            <div className="flex justify-between">
              <span className="text-gray-500">Ruta:</span>
              <span className="font-medium">
                {booking.trip.route?.origin} → {booking.trip.route?.destination}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Salida:</span>
              <span className="font-medium">{formatDateTime(booking.trip.departure_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Precio:</span>
              <span className="font-medium">{formatPrice(booking.trip.price)}</span>
            </div>
          </>
        )}
        {booking.seat && (
          <div className="flex justify-between">
            <span className="text-gray-500">Asiento:</span>
            <span className="font-bold text-lg text-blue-600">{booking.seat.seat_code}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-500">Estado:</span>
          <span
            className={`font-medium ${booking.status === 'confirmed' ? 'text-green-600' : 'text-red-600'}`}
          >
            {booking.status === 'confirmed' ? 'Confirmado' : 'Cancelado'}
          </span>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200 text-center">
        <p className="text-xs text-gray-400">
          Presenta este código QR al abordar el bus
        </p>
      </div>
    </div>
  );
}
