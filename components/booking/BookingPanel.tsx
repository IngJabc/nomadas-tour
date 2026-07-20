'use client';

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import QRCode from 'react-qr-code';
import { Seat } from '@/types';
import { customerApi } from '@/lib/api';

interface BookingPanelProps {
  selectedSeats: Seat[];
  tripId: string;
  onSuccess: (bookingIds: string[]) => void;
  onClear: () => void;
  onReleaseLocks?: (seatIds: string[]) => Promise<void>;
}

export function BookingPanel({
  selectedSeats,
  tripId,
  onSuccess,
  onClear,
  onReleaseLocks,
}: BookingPanelProps) {
  const [passengerName, setPassengerName] = useState('');
  const [passengerCedula, setPassengerCedula] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [lastTransactionId, setLastTransactionId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [lastSeatCodes, setLastSeatCodes] = useState<string[] | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const submittingRef = useRef(false);

  const handleConfirm = async () => {
    if (submittingRef.current) return;
    if (!passengerName.trim() || !passengerCedula.trim()) {
      setError('Complete todos los campos');
      setShakeKey((k) => k + 1);
      return;
    }
    if (!/^[A-Za-zÁÉÍÓÚÑáéíóúñüÜ\s]+$/.test(passengerName.trim())) {
      setError('El nombre solo puede contener letras y espacios');
      setShakeKey((k) => k + 1);
      return;
    }
    if (!/^\d+$/.test(passengerCedula.trim()) || passengerCedula.trim().length > 8) {
      setError('La cédula debe ser numérica de máximo 8 dígitos');
      setShakeKey((k) => k + 1);
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const seatCodes = selectedSeats.map((s) => s.seat_code);
      setLastSeatCodes(seatCodes);

      const result = await customerApi.createReservation({
        trip_id: tripId,
        customer_name: passengerName.trim(),
        passenger_cedula: passengerCedula.trim(),
        phone: phone.trim() || undefined,
        seat_codes: seatCodes,
      });

      setLastTransactionId(result.transaction_id);
      setQrDataUrl(result.qr_data_url);
      setConfirmed(true);
      const reservationIds = result.reservations.map((r: any) => r.id);
      onSuccess(reservationIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al confirmar reserva');
      if (onReleaseLocks) {
        await onReleaseLocks(selectedSeats.map((s) => s.id));
      }
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {confirmed ? (
        <motion.div
          key="confirmed"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="bg-white rounded-2xl p-6 text-center"
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 bg-emerald-50">
            <motion.svg
              width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth={2.5}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            >
              <motion.path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </motion.svg>
          </div>

          <h3 className="font-['Montserrat',sans-serif] font-bold text-xl text-brand-navy">
            ¡Reserva confirmada!
          </h3>
          <p className="mb-5 font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">
            Tus asientos han sido reservados exitosamente.
          </p>

          <div className="space-y-2 mb-4 text-left">
            {(lastSeatCodes ?? selectedSeats.map((s) => s.seat_code)).map((code) => (
              <div key={code} className="flex items-center gap-3 py-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-cyan)" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                </svg>
                <span className="font-['Poppins',sans-serif] font-semibold text-[13px] text-brand-navy">
                  Asiento {code}
                </span>
              </div>
            ))}
          </div>

          {qrDataUrl && (
            <div className="flex flex-col items-center mb-5">
              <div className="bg-white p-3 rounded-xl border border-slate-200">
                <img src={qrDataUrl} alt="QR de reserva" className="w-36 h-36" />
              </div>
              {lastTransactionId && (
                <p className="mt-2 font-['Poppins',sans-serif] font-normal text-[11px] text-brand-muted break-all max-w-[200px]">
                  Código: {lastTransactionId.slice(0, 8).toUpperCase()}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5">
            {lastTransactionId && (
              <Link
                href={`/bookings/${lastTransactionId}`}
                className="w-full sm:flex-1 px-5 py-3 bg-brand-navy text-white font-['Poppins',sans-serif] font-semibold text-sm rounded-xl no-underline transition-colors duration-200 flex items-center justify-center hover:bg-brand-blue"
              >
                Ver mi boleto
              </Link>
            )}
            <Link
              href="/dashboard"
              className="w-full sm:flex-1 px-5 py-3 bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-sm rounded-xl no-underline transition-colors duration-200 flex items-center justify-center"
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-brand-blue)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-brand-cyan)'; }}
            >
              Mis reservas
            </Link>
          </div>
        </motion.div>
      ) : selectedSeats.length === 0 ? (
        <motion.div
          key="empty"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="bg-white rounded-2xl p-6"
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
        >
          <div className="flex items-center gap-2 mb-5">
            <div className="w-1 h-[18px] bg-brand-cyan rounded-sm" />
            <h3 className="font-['Montserrat',sans-serif] font-bold text-lg text-brand-navy">
              Tu reserva
            </h3>
          </div>
          <div className="flex flex-col items-center py-8 text-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-muted)" strokeWidth={1.5} className="mb-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
            <p className="font-['Poppins',sans-serif] font-normal text-[13px] text-brand-muted max-w-[200px] leading-normal">
              Selecciona un asiento del mapa para continuar
            </p>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="panel"
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="bg-white rounded-2xl p-6"
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
        >
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="mb-4 bg-red-50 border border-red-500 rounded-xl px-3.5 py-2.5"
              >
                <p className="font-['Poppins',sans-serif] font-normal text-[13px] text-red-500">
                  {error}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-2 mb-5">
            <div className="w-1 h-[18px] bg-brand-cyan rounded-sm" />
            <h3 className="font-['Montserrat',sans-serif] font-bold text-lg text-brand-navy">
              Tu reserva
            </h3>
          </div>

          <div className="space-y-2 mb-4">
            {selectedSeats.map((s) => (
              <div key={s.seat_code} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex items-center justify-center text-brand-cyan font-['Poppins',sans-serif] font-semibold text-xs px-2 py-0.5 rounded-md min-w-[32px] text-center"
                    style={{ background: 'rgba(0,212,255,0.1)' }}
                  >
                    {s.seat_code}
                  </span>
                  <span className="font-['Poppins',sans-serif] font-normal text-[13px] text-brand-navy">
                    Asiento {s.seat_code}
                  </span>
                </div>
                </div>
              ))}
            </div>

            <div className="space-y-3 mb-4">
            <div>
              <label className="block mb-1 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
                Nombre del pasajero
              </label>
              <input
                type="text"
                value={passengerName}
                onChange={(e) => setPassengerName(e.target.value.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñüÜ\s]/g, ''))}
                placeholder="Ej. Juan Pérez"
                className="w-full border-[1.5px] border-gray-200 rounded-xl px-3.5 py-2.5 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy bg-white outline-none"
                style={{ transition: 'border-color 200ms, box-shadow 200ms' }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-brand-cyan)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,212,255,0.15)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#e5e7eb';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>
            <div>
              <label className="block mb-1 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
                Cédula del pasajero
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={passengerCedula}
                onChange={(e) => setPassengerCedula(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="Ej. 12345678"
                className="w-full border-[1.5px] border-gray-200 rounded-xl px-3.5 py-2.5 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy bg-white outline-none"
                style={{ transition: 'border-color 200ms, box-shadow 200ms' }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-brand-cyan)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,212,255,0.15)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#e5e7eb';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>
            <div>
              <label className="block mb-1 font-['Poppins',sans-serif] font-medium text-xs text-brand-muted uppercase tracking-wider">
                Teléfono (opcional)
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 15))}
                placeholder="Ej. 8095551234"
                className="w-full border-[1.5px] border-gray-200 rounded-xl px-3.5 py-2.5 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy bg-white outline-none"
                style={{ transition: 'border-color 200ms, box-shadow 200ms' }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-brand-cyan)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,212,255,0.15)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#e5e7eb';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>
          </div>

          <motion.div
            key={`shake-${shakeKey}`}
            animate={error ? { x: [0, -4, 4, -4, 4, 0] } : undefined}
            transition={{ duration: 0.4 }}
            className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3"
          >
            <button
              type="button"
              onClick={onClear}
              disabled={loading}
              className="w-full sm:flex-1 px-4 py-3 sm:py-2.5 bg-slate-100 text-brand-navy font-['Poppins',sans-serif] font-semibold text-sm rounded-xl border-none transition-colors duration-200"
              style={{ cursor: loading ? 'not-allowed' : 'pointer' }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#e2e8f0'; }}
              onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = 'var(--color-page-bg)'; }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className="w-full sm:flex-1 px-4 py-3 sm:py-2.5 text-white font-['Poppins',sans-serif] font-semibold text-sm rounded-xl border-none transition-colors duration-200"
              style={{
                background: loading ? '#94a3b8' : 'var(--color-brand-cyan)',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = 'var(--color-brand-blue)'; }}
              onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = 'var(--color-brand-cyan)'; }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Procesando...
                </span>
              ) : (
                'Confirmar reserva'
              )}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
