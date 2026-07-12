'use client';

import { QRCode } from 'react-qr-code';
import { Reservation } from '@/types';
import { formatDateTime } from '@/lib/utils';

interface QRTicketProps {
  reservations: Reservation[];
}

export function QRTicket({ reservations }: QRTicketProps) {
  const first = reservations[0];
  if (!first) return null;

  const seatCodes = [...new Set(reservations.map((r) => r.seat_code).filter((s): s is string => !!s))];
  const qrValue = first.qr_code;

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
            Boleto de viaje
          </h3>
          <p className="text-xs sm:text-sm text-brand-muted">Presenta este código QR al abordar</p>
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
            <span className="text-sm font-medium text-brand-navy">{first.customer_name}</span>
          </div>
          <div className="flex justify-between py-3">
            <span className="text-sm text-brand-muted">Cédula</span>
            <span className="text-sm font-medium text-brand-navy">{first.passenger_cedula}</span>
          </div>
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
