'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { request } from '@/lib/api';

interface Props {
  tripId: string;
  transactionId: string;
  reservationIds: string[];
}

export function CancelBookingButton({ tripId, transactionId, reservationIds }: Props) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCancel = async () => {
    setLoading(true);
    setError(null);
    try {
      await request('/reservations/cancel', {
        method: 'POST',
        body: JSON.stringify({ trip_id: tripId, transaction_id: transactionId }),
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cancelar');
    } finally {
      setLoading(false);
    }
  };

  const label = reservationIds.length > 1 ? `Cancelar reserva (${reservationIds.length} asientos)` : 'Cancelar reserva';

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        disabled={loading}
        className="font-['Poppins',sans-serif] font-normal text-[13px] text-red-500 bg-none border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:underline"
      >
        {loading ? 'Cancelando...' : label}
      </button>

      {error && (
        <p className="font-['Poppins',sans-serif] font-normal text-[11px] text-red-500 mt-1">{error}</p>
      )}

      <ConfirmModal
        open={modalOpen}
        title="Cancelar reserva"
        message={
          reservationIds.length > 1
            ? `¿Estás seguro de cancelar estos ${reservationIds.length} asientos? Los asientos quedarán disponibles para otros pasajeros.`
            : '¿Estás seguro de cancelar esta reserva? El asiento quedará disponible para otros pasajeros.'
        }
        confirmLabel="Cancelar reserva"
        cancelLabel="Volver"
        onConfirm={handleCancel}
        onCancel={() => {
          setModalOpen(false);
          setError(null);
        }}
      />
    </>
  );
}
