'use client';

import { useState, useRef, useEffect } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface TripActionsProps {
  trip: { id: string; status: string; departure_time: string };
  onEdit: () => void;
  onAction: (tripId: string, action: string) => void;
  actionLoading: boolean;
  canComplete: boolean;
  canCancelPostpone: boolean;
  onMenuToggle?: (open: boolean) => void;
}

export function TripActions({
  trip,
  onEdit,
  onAction,
  actionLoading,
  canComplete,
  canCancelPostpone,
  onMenuToggle,
}: TripActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleMenu = (open: boolean) => {
    setMenuOpen(open);
    onMenuToggle?.(open);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        toggleMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const isActive = trip.status === 'active';

  type Action = {
    key: string;
    label: string;
    variant?: 'secondary' | 'destructive';
    className?: string;
    onClick: () => void;
  };

  const actions: Action[] = [];

  actions.push({
    key: 'view',
    label: 'Ver detalle',
    variant: 'secondary',
    onClick: () => onAction(trip.id, 'view'),
  });

  if (isActive) {
    actions.push({
      key: 'edit',
      label: 'Editar',
      variant: 'secondary',
      onClick: onEdit,
    });
    if (canCancelPostpone) {
      actions.push({
        key: 'postpone',
        label: 'Posponer',
        variant: 'secondary',
        className: '!bg-[#f59e0b] hover:!bg-[#d97706] !text-white',
        onClick: () => onAction(trip.id, 'postpone'),
      });
    }
    if (canComplete) {
      actions.push({
        key: 'complete',
        label: 'Completar',
        variant: 'secondary',
        className: '!bg-[#10b981] hover:!bg-[#059669] !text-white',
        onClick: () => onAction(trip.id, 'complete'),
      });
    }
    if (canCancelPostpone) {
      actions.push({
        key: 'cancel',
        label: 'Cancelar',
        variant: 'destructive',
        onClick: () => onAction(trip.id, 'cancel'),
      });
    }
  }
  actions.push({
    key: 'delete',
    label: 'Eliminar',
    variant: 'destructive',
    onClick: () => onAction(trip.id, 'delete'),
  });

  const renderButton = (action: Action) => (
    <Button
      key={action.key}
      variant={action.variant}
      size="sm"
      disabled={actionLoading}
      onClick={action.onClick}
      className={action.className}
    >
      {action.label}
    </Button>
  );

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-[rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-2 min-w-0">
          {actions.slice(0, 3).map(renderButton)}
        </div>

        {actions.length > 3 && (
          <div className="relative flex-shrink-0" ref={menuRef}>
            <Button
              variant="secondary"
              size="sm"
              disabled={actionLoading}
              onClick={() => toggleMenu(!menuOpen)}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </Button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-200/60 py-1 min-w-[150px] z-50">
                {actions.slice(3).map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    disabled={actionLoading}
                    onClick={() => { action.onClick(); toggleMenu(false); }}
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
    </div>
  );
}
