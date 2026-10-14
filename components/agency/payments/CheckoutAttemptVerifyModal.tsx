'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { agencyApi } from '@/lib/api';
import { formatSeatPriceCents } from '@/lib/price';
import type { VerifyCheckoutAttemptResult } from '@/lib/payments';

interface CheckoutAttemptVerifyModalProps {
  open: boolean;
  attemptId: string;
  amountCents: number;
  onClose: () => void;
  onSuccess: (result: VerifyCheckoutAttemptResult) => void;
}

/**
 * Modal de confirmación para verificar un intento de checkout. La verificación
 * es atómica: crea la reserva definitiva, el pago verificado y las asignaciones
 * de asientos en una sola RPC. No puede deshacerse.
 */
export function CheckoutAttemptVerifyModal({
  open,
  attemptId,
  amountCents,
  onClose,
  onSuccess,
}: CheckoutAttemptVerifyModalProps) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) setLoading(false);
  }, [open]);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const result = await agencyApi.verifyCheckoutAttempt(attemptId);
      toast.success(
        result.already_verified
          ? 'Esta compra ya había sido verificada.'
          : 'Compra verificada. La reserva y el pago fueron creados.',
      );
      onSuccess(result);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'No se pudo verificar la compra. Intenta de nuevo.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ConfirmModal
      open={open}
      title="Verificar compra"
      message={`Vas a aprobar el comprobante de ${formatSeatPriceCents(amountCents)}. Esto creará la reserva definitiva, marcará el pago como verificado y confirmará los asientos. Esta acción no puede deshacerse.`}
      confirmLabel="Verificar compra"
      cancelLabel="Cancelar"
      variant="confirm"
      loading={loading}
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
  );
}
