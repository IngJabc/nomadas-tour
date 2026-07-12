'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PostponeModalProps {
  open: boolean;
  tripName: string;
  currentDate: string;
  onConfirm: (newDate: string) => Promise<void>;
  onCancel: () => void;
}

export function PostponeModal({ open, tripName, currentDate, onConfirm, onCancel }: PostponeModalProps) {
  const [newDate, setNewDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!newDate) {
      setError('Selecciona una nueva fecha y hora');
      return;
    }
    const selected = new Date(newDate);
    if (selected <= new Date()) {
      setError('La nueva fecha debe ser posterior a ahora');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onConfirm(newDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al posponer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/40"
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="relative bg-white rounded-2xl shadow-xl border border-slate-200/60 max-w-md w-full p-6"
          >
            <h2 className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)] mb-2">Posponer viaje</h2>
            <p className="font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-muted)] mb-4">
              {tripName} — fecha actual: <strong>{currentDate}</strong>
            </p>

            <label className="block mb-1 font-[family-name:var(--font-body)] font-medium text-xs text-[var(--color-brand-muted)] uppercase tracking-wider">
              Nueva fecha y hora de salida
            </label>
            <input
              type="datetime-local"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-white outline-none transition-all duration-200 focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] mb-4"
            />

            {error && (
              <p className="font-[family-name:var(--font-body)] text-[13px] text-[#ef4444] mb-3">{error}</p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="bg-[#f1f5f9] text-[var(--color-brand-navy)] font-[family-name:var(--font-body)] font-semibold text-sm px-5 py-2.5 rounded-xl border-none cursor-pointer hover:bg-[#e2e8f0] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleSubmit}
                className="bg-[var(--color-brand-cyan)] text-white font-[family-name:var(--font-body)] font-semibold text-sm px-5 py-2.5 rounded-xl border-none cursor-pointer transition-colors duration-200 hover:bg-[var(--color-brand-blue)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Posponiendo...' : 'Posponer'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
