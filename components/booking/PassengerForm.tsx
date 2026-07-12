'use client';

import { User } from 'lucide-react';
import { Seat } from '@/types';

interface PassengerData {
  seat_id: string;
  seat_code: string;
  name: string;
  document: string;
  phone: string;
}

interface PassengerFormProps {
  selectedSeats: Seat[];
  bookerName: string;
  bookerDocument: string;
  onBookerChange: (name: string, document: string) => void;
  passengers: PassengerData[];
  onPassengerChange: (index: number, field: keyof PassengerData, value: string) => void;
  errors: Record<string, string>;
}

export function PassengerForm({
  selectedSeats,
  bookerName,
  bookerDocument,
  onBookerChange,
  passengers,
  onPassengerChange,
  errors,
}: PassengerFormProps) {
  return (
    <div className="space-y-6">
      {/* Booker info */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-1 h-[18px] bg-[var(--color-brand-cyan)] rounded-sm" />
          <h3 className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]">
            Datos del comprador
          </h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block mb-1 font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider">
              Nombre completo <span className="text-[#ef4444]">*</span>
            </label>
            <input
              type="text"
              value={bookerName}
              onChange={(e) => onBookerChange(e.target.value, bookerDocument)}
              placeholder="Ej. María García"
              className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-[var(--color-brand-surface)] outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all"
            />
            {errors.bookerName && (
              <p className="mt-1 font-[family-name:var(--font-body)] font-normal text-[12px] text-[#ef4444]">{errors.bookerName}</p>
            )}
          </div>
          <div>
            <label className="block mb-1 font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider">
              Documento <span className="text-[#ef4444]">*</span>
            </label>
            <input
              type="text"
              value={bookerDocument}
              onChange={(e) => onBookerChange(bookerName, e.target.value.replace(/\D/g, '').slice(0, 15))}
              placeholder="Ej. 12345678"
              className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-[var(--color-brand-surface)] outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all"
            />
            {errors.bookerDocument && (
              <p className="mt-1 font-[family-name:var(--font-body)] font-normal text-[12px] text-[#ef4444]">{errors.bookerDocument}</p>
            )}
          </div>
        </div>
      </div>

      {/* Passengers per seat */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-1 h-[18px] bg-[var(--color-brand-cyan)] rounded-sm" />
          <h3 className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]">
            Pasajeros ({selectedSeats.length})
          </h3>
        </div>

        <div className="space-y-4">
          {selectedSeats.map((seat, index) => {
            const p = passengers[index];
            const nameErr = errors[`passenger_${index}_name`];
            const docErr = errors[`passenger_${index}_document`];
            return (
              <div
                key={seat.id}
                className="bg-[var(--color-page-bg)] rounded-xl p-4 border border-[rgba(0,0,0,0.06)]"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-[rgba(0,212,255,0.1)]">
                    <User className="w-3.5 h-3.5 text-[var(--color-brand-cyan)]" />
                  </div>
                  <span className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-navy)]">
                    Asiento {seat.seat_code}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block mb-1 font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider">
                      Nombre <span className="text-[#ef4444]">*</span>
                    </label>
                    <input
                      type="text"
                      value={p.name}
                      onChange={(e) => onPassengerChange(index, 'name', e.target.value)}
                      placeholder="Nombre del pasajero"
                      className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all"
                    />
                    {nameErr && <p className="mt-1 font-[family-name:var(--font-body)] font-normal text-[12px] text-[#ef4444]">{nameErr}</p>}
                  </div>
                  <div>
                    <label className="block mb-1 font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider">
                      Documento <span className="text-[#ef4444]">*</span>
                    </label>
                    <input
                      type="text"
                      value={p.document}
                      onChange={(e) => onPassengerChange(index, 'document', e.target.value.replace(/\D/g, '').slice(0, 15))}
                      placeholder="Cédula / Pasaporte"
                      className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all"
                    />
                    {docErr && <p className="mt-1 font-[family-name:var(--font-body)] font-normal text-[12px] text-[#ef4444]">{docErr}</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block mb-1 font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider">
                      Teléfono (opcional)
                    </label>
                    <input
                      type="tel"
                      value={p.phone}
                      onChange={(e) => onPassengerChange(index, 'phone', e.target.value.replace(/\D/g, '').slice(0, 15))}
                      placeholder="Ej. 8095551234"
                      className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
