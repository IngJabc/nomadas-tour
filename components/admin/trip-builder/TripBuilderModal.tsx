'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Modal, ModalHeader, ModalDivider, ModalBody } from '@/components/ui/Modal';
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
    <Modal open={open} onClose={onClose}>
      <ModalHeader>
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
      </ModalHeader>
      <ModalDivider />
      <ModalBody>
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
      </ModalBody>
    </Modal>
  );
}
