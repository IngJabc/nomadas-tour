'use client';

import { QRCode } from 'react-qr-code';
import { Booking } from '@/types';
import { formatDateTime, formatPrice } from '@/lib/utils';

interface QRTicketProps {
  bookings: Booking[];
}

function generateQRContent(booking: Booking, seatCodes: string[]): string {
  const origin = booking.trip?.route?.origin ?? '';
  const destination = booking.trip?.route?.destination ?? '';
  const departure = booking.trip?.departure_at ?? '';
  const price = Number(booking.trip?.price ?? 0);
  const total = seatCodes.length * price;
  const d = departure ? new Date(departure) : null;
  const departFormatted = d
    ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : '';
  return [
    `NOMADAS TOUR`,
    `Codigo: ${booking.qr_code}`,
    `Pasajero: ${booking.passenger_name}`,
    `Cedula: ${booking.passenger_email}`,
    `Ruta: ${origin} - ${destination}`,
    `Salida: ${departFormatted}`,
    `Asientos: ${seatCodes.join(', ')}`,
    `Total: ${(isNaN(total) ? 0 : total).toFixed(2).replace('.', ',')} EUR`,
  ].join('\n');
}

export function QRTicket({ bookings }: QRTicketProps) {
  const first = bookings[0];
  if (!first) return null;

  const seatCodes = [...new Set(bookings.map((b) => b.seat?.seat_code).filter((s): s is string => !!s))];
  const seatCount = seatCodes.length;
  const totalPrice = first.trip?.price ? seatCount * Number(first.trip.price) : 0;
  const qrValue = generateQRContent(first, seatCodes);

  return (
    <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200/60 w-full max-w-sm mx-auto overflow-hidden">
      <div className="p-5 sm:p-8">
        <div className="text-center mb-5 sm:mb-6">
          <div className="w-11 h-11 sm:w-12 sm:h-12 bg-brand-navy rounded-xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-brand-navy/20">
            <svg className="w-5 h-5 sm:w-6 sm:h-6 text-brand-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="font-bold text-base sm:text-lg text-brand-navy tracking-tight">
            {first.trip?.route?.origin ?? '?'} → {first.trip?.route?.destination ?? '?'}
          </h3>
          <p className="text-xs sm:text-sm text-brand-muted">{first.trip ? formatDateTime(first.trip.departure_at) : 'Boleto de viaje'}</p>
        </div>

        <div className="flex justify-center mb-5 sm:mb-6">
          <div className="bg-white p-3 sm:p-4 rounded-2xl shadow-inner border border-slate-100">
            <QRCode value={qrValue} size={160} />
          </div>
        </div>

        <div className="space-y-0 divide-y divide-slate-100">
          <div className="flex justify-between py-3">
            <span className="text-sm text-brand-muted">Código</span>
            <span className="text-sm font-mono font-bold text-brand-navy">{first.qr_code}</span>
          </div>
          <div className="flex justify-between py-3">
            <span className="text-sm text-brand-muted">Pasajero</span>
            <span className="text-sm font-medium text-brand-navy">{first.passenger_name}</span>
          </div>
          <div className="flex justify-between py-3">
            <span className="text-sm text-brand-muted">Cédula</span>
            <span className="text-sm font-medium text-brand-navy">{first.passenger_email}</span>
          </div>
          {first.trip && (
            <>
              <div className="flex justify-between py-3">
                <span className="text-sm text-brand-muted">Ruta</span>
                <span className="text-sm font-medium text-brand-navy text-right">
                  {first.trip.route?.origin} → {first.trip.route?.destination}
                </span>
              </div>
              <div className="flex justify-between py-3">
                <span className="text-sm text-brand-muted">Salida</span>
                <span className="text-sm font-medium text-brand-navy">{formatDateTime(first.trip.departure_at)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between py-3">
            <span className="text-sm text-brand-muted">Asientos</span>
            <div className="flex flex-wrap gap-1.5 justify-end max-w-[200px]">
              {seatCodes.length > 4 ? (
                <div className="grid grid-cols-2 gap-1">
                  {seatCodes.map((code) => (
                    <span
                      key={code}
                      className="bg-brand-cyan/10 text-brand-cyan font-['Poppins',sans-serif] font-semibold text-[13px] rounded-md px-2 py-0.5 text-center"
                    >
                      {code}
                    </span>
                  ))}
                </div>
              ) : (
                seatCodes.map((code) => (
                  <span
                    key={code}
                    className="bg-brand-cyan/10 text-brand-cyan font-['Poppins',sans-serif] font-semibold text-[13px] rounded-md px-2 py-0.5"
                  >
                    {code}
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="flex justify-between py-3">
            <span className="text-sm text-brand-muted">Total</span>
            <span className="text-sm font-bold text-brand-cyan">{formatPrice(totalPrice)}</span>
          </div>
          <div className="flex justify-between py-3">
            <span className="text-sm text-brand-muted">Estado</span>
            <span
              className={`font-semibold px-2.5 py-0.5 rounded-full text-xs ${
                first.status === 'confirmed'
                  ? 'text-brand-cyan bg-brand-cyan/10'
                  : 'text-red-400 bg-red-50'
              }`}
            >
              {first.status === 'confirmed' ? 'Confirmado' : 'Cancelado'}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-slate-50/80 px-6 sm:px-8 py-4 border-t border-slate-100">
        <p className="text-xs text-brand-muted text-center">
          Presenta este código QR al abordar el bus
        </p>
      </div>
    </div>
  );
}
