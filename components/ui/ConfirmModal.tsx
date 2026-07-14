'use client';

import { useId } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'confirm';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Eliminar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  loading,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const instanceId = useId();
  const titleId = `confirm-title-${instanceId}`;
  const descriptionId = `confirm-description-${instanceId}`;

  return (
    <Modal open={open} onClose={onCancel} size="sm" titleId={titleId} descriptionId={descriptionId}>
      <div className="p-6">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-4 ${variant === 'danger' ? 'bg-red-50' : 'bg-[rgba(0,212,255,0.1)]'}`}>
          {variant === 'danger' ? (
            <AlertTriangle className="w-5 h-5 text-red-400" strokeWidth={1.75} />
          ) : (
            <CheckCircle className="w-5 h-5 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
          )}
        </div>
        <p id={titleId} className="text-lg font-bold text-[var(--color-brand-navy)] text-center mb-2">{title}</p>
        <p id={descriptionId} className="text-sm text-[var(--color-brand-muted)] text-center mb-6">{message}</p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-semibold text-[var(--color-brand-muted)] bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors shadow-md disabled:opacity-40 ${variant === 'danger' ? 'bg-red-400 hover:bg-red-500' : 'bg-[var(--color-brand-cyan)] hover:bg-[var(--color-brand-blue)]'}`}
          >
            {loading ? 'Cargando...' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
