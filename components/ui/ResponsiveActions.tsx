'use client';

import { useState, useRef, useLayoutEffect, useCallback, useEffect } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface ResponsiveActionItem {
  key: string;
  label: string;
  variant?: 'secondary' | 'destructive';
  className?: string;
  onClick: () => void;
}

interface ResponsiveActionsProps {
  actions: ResponsiveActionItem[];
  disabled?: boolean;
  onMenuToggle?: (open: boolean) => void;
}

const OVERFLOW_BTN_WIDTH = 44;
const ACTION_GAP = 8;

export function ResponsiveActions({ actions, disabled, onMenuToggle }: ResponsiveActionsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(actions.length);
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = useCallback(
    (open: boolean) => {
      setMenuOpen(open);
      onMenuToggle?.(open);
    },
    [onMenuToggle],
  );

  const computeVisible = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure || actions.length === 0) {
      setVisibleCount(actions.length);
      return;
    }

    const buttons = measure.querySelectorAll<HTMLElement>('[data-action-measure]');
    const containerWidth = container.clientWidth;
    let used = 0;
    let count = 0;

    for (let i = 0; i < buttons.length; i++) {
      const btnWidth = buttons[i].offsetWidth + (count > 0 ? ACTION_GAP : 0);
      const remaining = actions.length - (i + 1);
      const reserveOverflow = remaining > 0 ? OVERFLOW_BTN_WIDTH + ACTION_GAP : 0;

      if (used + btnWidth + reserveOverflow <= containerWidth) {
        used += btnWidth;
        count++;
      } else {
        break;
      }
    }

    if (count === 0 && actions.length > 0) count = 1;
    setVisibleCount(count);
  }, [actions]);

  useLayoutEffect(() => {
    computeVisible();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(computeVisible);
    ro.observe(container);
    return () => ro.disconnect();
  }, [computeVisible]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        toggleMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen, toggleMenu]);

  const visibleActions = actions.slice(0, visibleCount);
  const overflowActions = actions.slice(visibleCount);

  const renderButton = (action: ResponsiveActionItem) => (
    <Button
      key={action.key}
      variant={action.variant}
      size="sm"
      disabled={disabled}
      onClick={action.onClick}
      className={action.className}
    >
      {action.label}
    </Button>
  );

  return (
    <>
      <div
        ref={measureRef}
        className="fixed -left-[9999px] top-0 flex gap-2 invisible pointer-events-none"
        aria-hidden
      >
        {actions.map((action) => (
          <Button
            key={`measure-${action.key}`}
            data-action-measure
            variant={action.variant}
            size="sm"
            className={action.className}
            tabIndex={-1}
          >
            {action.label}
          </Button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 pt-3 border-t border-[rgba(0,0,0,0.06)]">
        <div ref={containerRef} className="flex items-center gap-2 min-w-0 flex-1">
          {visibleActions.map(renderButton)}
        </div>

        {overflowActions.length > 0 && (
          <div className="relative flex-shrink-0" ref={menuRef}>
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => toggleMenu(!menuOpen)}
              aria-label="Más acciones"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </Button>
            {menuOpen && (
              <div className="absolute right-0 bottom-full mb-1 bg-white rounded-xl shadow-lg border border-slate-200/60 py-1 min-w-[150px] z-50">
                {overflowActions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      action.onClick();
                      toggleMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm font-[family-name:var(--font-body)] font-medium text-[var(--color-brand-navy)] hover:bg-slate-50 transition-colors disabled:opacity-40"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
