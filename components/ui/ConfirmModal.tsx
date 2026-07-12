'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'confirm';
  onConfirm: () => void;
  onCancel: () => void;
}

// Small helper to query focusable elements inside a container
function getFocusable(container: HTMLElement | null) {
  if (!container) return [] as HTMLElement[];
  const nodes = container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
  );
  return Array.from(nodes).filter((n) => !n.hasAttribute('disabled'));
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Eliminar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // focus first focusable element inside modal
    const focusable = getFocusable(dialogRef.current);
    if (focusable.length) focusable[0].focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }

      if (e.key === 'Tab') {
        const focusableEls = getFocusable(dialogRef.current);
        if (focusableEls.length === 0) return;
        const first = focusableEls[0];
        const last = focusableEls[focusableEls.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // restore focus
      previouslyFocused.current?.focus();
    };
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" aria-hidden={!open}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="relative bg-white rounded-2xl shadow-xl border border-slate-200/60 p-6 w-full max-w-sm"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-4 ${variant === 'danger' ? 'bg-red-50' : 'bg-[rgba(0,212,255,0.1)]'}`}>
              {variant === 'danger' ? (
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-[var(--color-brand-cyan)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
            <h3 id="confirm-modal-title" className="text-lg font-bold text-brand-navy text-center mb-2">{title}</h3>
            <p className="text-sm text-brand-muted text-center mb-6">{message}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-brand-muted bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors shadow-md ${variant === 'danger' ? 'bg-red-400 hover:bg-red-500' : 'bg-[var(--color-brand-cyan)] hover:bg-[var(--color-brand-blue)]'}`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
