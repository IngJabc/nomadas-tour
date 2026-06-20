'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
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
  const [passengerCedula, setPassengerCedula] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [lastBookingIds, setLastBookingIds] = useState<string[] | null>(null);
  const [lastSeatCodes, setLastSeatCodes] = useState<string[] | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

  const total = selectedSeats.length * price;

  const handleConfirm = async () => {
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

    setLoading(true);
    setError(null);

    try {
      const bookingIds: string[] = [];
      const groupKey = Math.random().toString(36).substring(2, 10).toUpperCase();
      setLastSeatCodes(selectedSeats.map((s) => s.seat_code));

      for (const seat of selectedSeats) {
        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trip_id: tripId,
            seat_id: seat.id,
            passenger_name: passengerName.trim(),
            passenger_cedula: passengerCedula.trim(),
            qr_code: groupKey,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
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

      setLastBookingIds(bookingIds);
      setConfirmed(true);
      onSuccess(bookingIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al confirmar reserva');
    } finally {
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
          style={{
            background: '#ffffff',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            textAlign: 'center',
          }}
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: '#ecfdf5' }}
          >
            <motion.svg
              width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth={2.5}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            >
              <motion.path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </motion.svg>
          </div>

          <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 20, color: 'var(--color-brand-navy)' }}>
            ¡Reserva confirmada!
          </h3>
          <p className="mb-5" style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 14, color: 'var(--color-brand-muted)' }}>
            Tus asientos han sido reservados exitosamente.
          </p>

          <div className="space-y-2 mb-4 text-left">
            {(lastSeatCodes ?? selectedSeats.map((s) => s.seat_code)).map((code) => (
              <div key={code} className="flex items-center gap-3 py-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-cyan)" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                </svg>
                <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, color: 'var(--color-brand-navy)' }}>
                  Asiento {code}
                </span>
                <span className="ml-auto" style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: 'var(--color-brand-muted)' }}>
                  {formatPrice(price)}
                </span>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: '#f1f5f9', margin: '12px 0' }} />

          <div className="flex items-center justify-between mb-5">
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16, color: 'var(--color-brand-navy)' }}>
              Total pagado
            </span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22, color: 'var(--color-brand-cyan)' }}>
              {formatPrice(((lastSeatCodes ? lastSeatCodes.length : (lastBookingIds ? lastBookingIds.length : selectedSeats.length)) * price) || 0)}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            {lastBookingIds && lastBookingIds[0] && (
              <Link
                href={`/bookings/${lastBookingIds[0]}`}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  background: '#f1f5f9',
                  color: 'var(--color-brand-navy)',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 600,
                  fontSize: 14,
                  borderRadius: 10,
                  textDecoration: 'none',
                  transition: 'background 200ms',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                Ver boleto
              </Link>
            )}
            <Link
              href="/dashboard"
              style={{
                flex: 1,
                padding: '12px 20px',
                background: 'var(--color-brand-cyan)',
                color: '#ffffff',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 14,
                borderRadius: 10,
                textDecoration: 'none',
                transition: 'background 200ms',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-brand-blue)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-brand-cyan)'; }}
            >
              Ver mis reservas
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
          style={{
            background: '#ffffff',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          }}
        >
          <div className="flex items-center gap-2 mb-5">
            <div style={{ width: 4, height: 18, background: 'var(--color-brand-cyan)', borderRadius: 2 }} />
            <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, color: 'var(--color-brand-navy)' }}>
              Tu reserva
            </h3>
          </div>
          <div className="flex flex-col items-center py-8 text-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-muted)" strokeWidth={1.5} style={{ marginBottom: 16 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
            <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: 'var(--color-brand-muted)', maxWidth: 200, lineHeight: 1.5 }}>
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
          style={{
            background: '#ffffff',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          }}
        >
          {/* Error banner */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="mb-4"
                style={{
                  background: '#fef2f2',
                  border: '1px solid #ef4444',
                  borderRadius: 10,
                  padding: '10px 14px',
                }}
              >
                <p style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: '#ef4444' }}>
                  No se pudo completar la reserva. Inténtalo de nuevo.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-2 mb-5">
            <div style={{ width: 4, height: 18, background: 'var(--color-brand-cyan)', borderRadius: 2 }} />
            <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, color: 'var(--color-brand-navy)' }}>
              Tu reserva
            </h3>
          </div>

          {/* Selected seats list */}
          <div className="space-y-2 mb-4">
            {selectedSeats.map((s) => (
              <div key={s.seat_code} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-3">
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(8,142,184,0.1)',
                      color: 'var(--color-brand-cyan)',
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 600,
                      fontSize: 12,
                      padding: '2px 8px',
                      borderRadius: 6,
                      minWidth: 32,
                      textAlign: 'center',
                    }}
                  >
                    {s.seat_code}
                  </span>
                  <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: 'var(--color-brand-navy)' }}>
                    Asiento {s.seat_code}
                  </span>
                </div>
                <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, color: 'var(--color-brand-navy)' }}>
                  {formatPrice(price)}
                </span>
              </div>
            ))}
          </div>

          {/* Separator */}
          <div style={{ height: 1, background: '#f1f5f9', margin: '12px 0' }} />

          {/* Total */}
          <div className="flex items-center justify-between mb-5">
            <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, color: 'var(--color-brand-navy)' }}>
              Total
            </span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22, color: 'var(--color-brand-cyan)' }}>
              {formatPrice(total)}
            </span>
          </div>

          {/* Passenger form */}
          <div className="space-y-3 mb-4">
            <div>
              <label className="block mb-1"
                style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                Nombre del pasajero
              </label>
              <input
                type="text"
                value={passengerName}
                onChange={(e) => setPassengerName(e.target.value.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñüÜ\s]/g, ''))}
                placeholder="Ej. Juan Pérez"
                className="w-full"
                style={{
                  border: '1.5px solid #e5e7eb',
                  borderRadius: 10,
                  padding: '10px 14px',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 14,
                  color: 'var(--color-brand-navy)',
                  background: '#ffffff',
                  outline: 'none',
                  transition: 'border-color 200ms, box-shadow 200ms',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-brand-cyan)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(8,142,184,0.12)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#e5e7eb';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>
            <div>
              <label className="block mb-1"
                style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                Cédula del pasajero
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={passengerCedula}
                onChange={(e) => setPassengerCedula(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="Ej. 12345678"
                className="w-full"
                style={{
                  border: '1.5px solid #e5e7eb',
                  borderRadius: 10,
                  padding: '10px 14px',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 14,
                  color: 'var(--color-brand-navy)',
                  background: '#ffffff',
                  outline: 'none',
                  transition: 'border-color 200ms, box-shadow 200ms',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-brand-cyan)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(8,142,184,0.12)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#e5e7eb';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>
          </div>

          {/* Actions */}
          <motion.div
            key={`shake-${shakeKey}`}
            animate={error ? { x: [0, -4, 4, -4, 4, 0] } : undefined}
            transition={{ duration: 0.4 }}
            className="flex gap-3"
          >
            <button
              type="button"
              onClick={onClear}
              disabled={loading}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: '#f1f5f9',
                color: 'var(--color-brand-navy)',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 14,
                borderRadius: 10,
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'background 200ms',
              }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#e2e8f0'; }}
              onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = '#f1f5f9'; }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              style={{
                flex: 1,
                padding: '10px 16px',
                background: loading ? '#94a3b8' : 'var(--color-brand-cyan)',
                color: '#ffffff',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 14,
                borderRadius: 10,
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'background 200ms',
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
