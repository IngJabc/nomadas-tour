'use client';

import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

let modalCount = 0;

const VIEWPORT_PADDING = 16;
const ANCHOR_GAP = 12;

function getFocusable(container: HTMLElement | null) {
  if (!container) return [] as HTMLElement[];
  const nodes = container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
  );
  return Array.from(nodes).filter((n) => !n.hasAttribute('disabled'));
}

function getScrollbarWidth() {
  return window.innerWidth - document.documentElement.clientWidth;
}

function computeDialogPosition(anchorRect: DOMRect, dialogEl: HTMLElement) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxWidth = Math.min(384, vw - VIEWPORT_PADDING * 2);
  const dialogHeight = dialogEl.getBoundingClientRect().height || dialogEl.scrollHeight;
  const dialogWidth = maxWidth;

  let left = anchorRect.left + anchorRect.width / 2 - dialogWidth / 2;
  left = Math.max(VIEWPORT_PADDING, Math.min(left, vw - dialogWidth - VIEWPORT_PADDING));

  const anchorCenterY = anchorRect.top + anchorRect.height / 2;
  const spaceBelow = vh - VIEWPORT_PADDING - anchorCenterY;
  const spaceAbove = anchorCenterY - VIEWPORT_PADDING;

  let top: number;

  if (dialogHeight / 2 <= spaceBelow && dialogHeight / 2 <= spaceAbove) {
    top = anchorCenterY - dialogHeight / 2;
  } else if (spaceBelow < dialogHeight && spaceAbove >= spaceBelow) {
    top = anchorRect.top - ANCHOR_GAP - dialogHeight;
  } else if (spaceBelow < dialogHeight) {
    top = vh - VIEWPORT_PADDING - dialogHeight;
  } else {
    top = anchorCenterY - dialogHeight / 2;
  }

  top = Math.max(VIEWPORT_PADDING, Math.min(top, vh - VIEWPORT_PADDING - dialogHeight));

  return {
    top,
    left,
    width: dialogWidth,
    maxHeight: Math.min(vh * 0.8, vh - VIEWPORT_PADDING * 2),
  };
}

interface ContextualModalProps {
  open: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
  titleId?: string;
  descriptionId?: string;
  children: React.ReactNode;
  className?: string;
}

export function ContextualModal({
  open,
  onClose,
  anchorRect,
  titleId,
  descriptionId,
  children,
  className,
}: ContextualModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const [dialogPosition, setDialogPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    setPortalNode(document.body);
  }, []);

  const updatePosition = useCallback(() => {
    if (!anchorRect || !dialogRef.current) return;
    setDialogPosition(computeDialogPosition(anchorRect, dialogRef.current));
  }, [anchorRect]);

  useLayoutEffect(() => {
    if (!open || !anchorRect) {
      setDialogPosition(null);
      return;
    }

    updatePosition();

    const dialog = dialogRef.current;
    if (!dialog) return;

    const ro = new ResizeObserver(updatePosition);
    ro.observe(dialog);

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, anchorRect, updatePosition, children]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
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
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusable = getFocusable(dialogRef.current);
    if (focusable.length) focusable[0].focus();
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [open, handleKeyDown]);

  useEffect(() => {
    if (!open) return;
    modalCount++;
    if (modalCount === 1) {
      document.body.style.paddingRight = `${getScrollbarWidth()}px`;
      document.body.classList.add('no-scroll');
    }
    return () => {
      modalCount--;
      if (modalCount <= 0) {
        modalCount = 0;
        document.body.classList.remove('no-scroll');
        document.body.style.paddingRight = '';
      }
    };
  }, [open]);

  if (!portalNode) return null;

  return createPortal(
    <AnimatePresence>
      {open && anchorRect && (
        <div className="fixed inset-0 z-50" onClick={onClose}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute rounded-2xl bg-black/40"
            style={{
              top: anchorRect.top,
              left: anchorRect.left,
              width: anchorRect.width,
              height: anchorRect.height,
            }}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
            style={
              dialogPosition
                ? {
                    position: 'fixed',
                    top: dialogPosition.top,
                    left: dialogPosition.left,
                    width: dialogPosition.width,
                    maxHeight: dialogPosition.maxHeight,
                  }
                : {
                    position: 'fixed',
                    top: VIEWPORT_PADDING,
                    left: VIEWPORT_PADDING,
                    width: 384,
                    maxHeight: '80vh',
                    visibility: 'hidden' as const,
                  }
            }
            className={cn(
              'bg-white rounded-2xl shadow-xl border border-slate-200/60 overflow-y-auto flex flex-col pointer-events-auto z-10',
              className,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    portalNode,
  );
}

export function ContextualModalHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between shrink-0 px-6 pt-6 pb-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ContextualModalBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex-1 overflow-y-auto px-6 py-5', className)}>
      {children}
    </div>
  );
}

export function ContextualModalFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'shrink-0 flex items-center gap-3 px-6 py-4 border-t border-[rgba(0,0,0,0.06)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
