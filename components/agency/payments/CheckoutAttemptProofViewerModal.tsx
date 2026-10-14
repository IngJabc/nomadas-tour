'use client';

import { useEffect, useId, useState } from 'react';
import { Loader2, FileImage, X } from 'lucide-react';
import { Modal, ModalHeader, ModalBody } from '@/components/ui/Modal';
import { agencyApi } from '@/lib/api';

interface CheckoutAttemptProofViewerModalProps {
  open: boolean;
  attemptId: string;
  onClose: () => void;
}

/**
 * Visor de comprobante de un intento de checkout. La URL firmada se solicita
 * al backend bajo demanda cada vez que se abre el modal; nunca se persiste.
 * Caduca en 300 s (TTL del backend).
 */
export function CheckoutAttemptProofViewerModal({
  open,
  attemptId,
  onClose,
}: CheckoutAttemptProofViewerModalProps) {
  const instanceId = useId();
  const titleId = `proof-title-${instanceId}`;
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setUrl(null);

    agencyApi
      .getCheckoutAttemptProof(attemptId)
      .then((result) => {
        if (!cancelled) setUrl(result.url);
      })
      .catch(() => {
        if (!cancelled) {
          setError('No se pudo cargar el comprobante. Intenta de nuevo.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, attemptId]);

  return (
    <Modal open={open} onClose={onClose} size="lg" titleId={titleId}>
      <ModalHeader>
        <p
          id={titleId}
          className="font-[family-name:var(--font-heading)] font-bold text-base text-[var(--color-brand-navy)]"
        >
          Comprobante de pago
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar visor de comprobante"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-brand-muted)] hover:bg-slate-100 hover:text-[var(--color-brand-navy)] transition-colors"
        >
          <X className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </ModalHeader>
      <ModalBody className="flex items-center justify-center min-h-[320px]">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <Loader2 className="w-8 h-8 text-[var(--color-brand-cyan)] animate-spin" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]">
              Cargando comprobante…
            </p>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <FileImage className="w-10 h-10 text-[var(--color-brand-muted)]" strokeWidth={1.75} />
            <p className="font-[family-name:var(--font-body)] text-sm text-[var(--color-brand-muted)]">
              {error}
            </p>
          </div>
        )}

        {!loading && !error && url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Comprobante de pago"
            className="max-w-full max-h-[70vh] object-contain rounded-xl"
          />
        )}
      </ModalBody>
    </Modal>
  );
}
