'use client';

import { useEffect, useId, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { agencyApi } from '@/lib/api';
import {
  PAYMENT_REJECT_REASON_MAX,
  PAYMENT_REJECT_REASON_REQUIRED,
  type RejectCheckoutAttemptResult,
} from '@/lib/payments';

interface CheckoutAttemptRejectModalProps {
  open: boolean;
  attemptId: string;
  onClose: () => void;
  onSuccess: (result: RejectCheckoutAttemptResult) => void;
}

/**
 * Modal de rechazo de intento de checkout. Requiere motivo (1–500 caracteres).
 * Un rechazo NO final conserva los asientos y permite un reenvío. Si se rechaza
 * el tercer comprobante (último reenvío), el intento pasa a `rejected_final` y
 * se liberan únicamente los asientos que todavía pertenezcan a ese intento.
 */
export function CheckoutAttemptRejectModal({
  open,
  attemptId,
  onClose,
  onSuccess,
}: CheckoutAttemptRejectModalProps) {
  const instanceId = useId();
  const titleId = `reject-title-${instanceId}`;
  const descriptionId = `reject-description-${instanceId}`;
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
      setLoading(false);
    }
  }, [open]);

  const trimmed = reason.trim();
  const reasonError =
    touched && trimmed.length === 0 ? PAYMENT_REJECT_REASON_REQUIRED : null;
  const canSubmit = trimmed.length > 0 && trimmed.length <= PAYMENT_REJECT_REASON_MAX;

  const handleSubmit = async () => {
    setTouched(true);
    if (!canSubmit) return;

    setLoading(true);
    try {
      const result = await agencyApi.rejectCheckoutAttempt(attemptId, trimmed);
      toast.success(
        result.already_rejected
          ? 'Esta compra ya había sido rechazada.'
          : result.final
            ? 'Compra rechazada definitivamente.'
            : 'Compra rechazada. El cliente puede enviar un nuevo comprobante.',
      );
      onSuccess(result);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'No se pudo rechazar la compra. Intenta de nuevo.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      titleId={titleId}
      descriptionId={descriptionId}
    >
      <div className="p-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-4 bg-red-50">
          <AlertTriangle className="w-5 h-5 text-red-400" strokeWidth={1.75} />
        </div>
        <p
          id={titleId}
          className="text-lg font-bold text-[var(--color-brand-navy)] text-center mb-2"
        >
          Rechazar compra
        </p>
        <p
          id={descriptionId}
          className="text-sm text-[var(--color-brand-muted)] text-center mb-4"
        >
          Explica el motivo para dejar registro. Si aún quedan reenvíos
          disponibles, el cliente podrá enviar un nuevo comprobante.
        </p>

        <label
          htmlFor={`reject-reason-${instanceId}`}
          className="block font-[family-name:var(--font-body)] font-medium text-xs uppercase text-[var(--color-brand-muted)] mb-1.5"
        >
          Motivo del rechazo
        </label>
        <textarea
          id={`reject-reason-${instanceId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          maxLength={PAYMENT_REJECT_REASON_MAX}
          rows={3}
          placeholder="Ej: El comprobante no corresponde a este viaje"
          className="w-full border-[1.5px] border-[#e5e7eb] rounded-[10px] px-4 py-3 font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-navy)] bg-white outline-none resize-none focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)] transition-all duration-200"
        />
        <div className="flex items-center justify-between mt-1.5">
          <p className="font-[family-name:var(--font-body)] text-xs text-[#ef4444]">
            {reasonError ?? ''}
          </p>
          <p className="font-[family-name:var(--font-body)] text-xs text-[var(--color-brand-muted)]">
            {reason.length}/{PAYMENT_REJECT_REASON_MAX}
          </p>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-muted)] bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            loading={loading}
            className="flex-1"
          >
            <X className="w-4 h-4" />
            Rechazar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
