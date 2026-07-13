'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { BuilderLayout } from '@/components/admin/trip-builder/BuilderLayout';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/lib/api';

interface TripBuilderModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  tripId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function TripBuilderModal({ open, mode, tripId, onClose, onSuccess }: TripBuilderModalProps) {
  const [loading, setLoading] = useState(mode === 'edit');
  const [initialData, setInitialData] = useState<any>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
  }, [open]);

  // Lock body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  // Fetch trip data for edit mode
  useEffect(() => {
    if (!open || mode !== 'edit' || !tripId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    adminApi.getTrip(tripId)
      .then((trip: any) => {
        setInitialData({
          route_id: trip.route_id,
          departure_time: trip.departure_time
            ? new Date(trip.departure_time).toISOString().slice(0, 16)
            : '',
          vehicle_type: trip.vehicle_type ?? 'bus',
          agency_ids: (trip.trip_agencies || []).map((a: any) => a.agency_id),
        });
      })
      .catch(() => {
        setInitialData(null);
      })
      .finally(() => setLoading(false));
  }, [open, mode, tripId]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="relative bg-white rounded-2xl shadow-xl border border-slate-200/60 w-full max-w-2xl max-h-[90vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between shrink-0 px-6 pt-6 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-1 h-[18px] bg-[var(--color-brand-cyan)] rounded-sm" />
                <h2 className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]">
                  {mode === 'edit' ? 'Editar viaje' : 'Nuevo viaje'}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 p-2 -mr-2 rounded-lg text-[var(--color-brand-muted)] hover:text-[var(--color-brand-navy)] hover:bg-slate-100 transition-colors"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Divider */}
            <div className="shrink-0 h-px bg-[rgba(0,0,0,0.06)] mx-6" />

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {loading ? (
                <div className="py-8">
                  <CardSkeleton />
                </div>
              ) : (
                <BuilderLayout
                  mode={mode}
                  tripId={tripId}
                  initialData={initialData || undefined}
                  onSuccess={onSuccess}
                />
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
