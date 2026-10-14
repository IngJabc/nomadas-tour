'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { agencyApi } from '@/lib/api';
import { formatSeatPriceCents } from '@/lib/price';
import type { VerifyPaymentResult } from '@/lib/payments';

interface PaymentVerifyModalProps {
  open: boolean;
  paymentId: string;
  amountCents: number;
  onClose: () => void;
  onSuccess: (result: VerifyPaymentResult) => void;
}

/**
 * Modal de confirmación para verificar un pago. La acción es irreversible
 * en la práctica (un pago verificado no puede rechazarse); por eso pide
 * confirmación explícita antes de llamar al backend.
 */
export function PaymentVerifyModal({
  open,
  paymentId,
  amountCents,
  onClose,
  onSuccess,
}: PaymentVerifyModalProps) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) setLoading(false);
  }, [open]);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const result = await agencyApi.verifyPayment(paymentId);
      toast.success(
        result.already_verified
          ? 'Este pago ya había sido verificado.'
          : 'Pago verificado correctamente.',
      );
      onSuccess(result);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'No se pudo verificar el pago. Intenta de nuevo.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ConfirmModal
      open={open}
      title="Verificar pago"
      message={`Vas a marcar este pago de ${formatSeatPriceCents(amountCents)} como verificado. Esta acción confirma la recepción del dinero y no puede deshacerse.`}
      confirmLabel="Verificar pago"
      cancelLabel="Cancelar"
      variant="confirm"
      loading={loading}
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
  );
}
