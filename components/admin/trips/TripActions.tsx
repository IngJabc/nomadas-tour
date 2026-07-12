'use client';

import { useState, useRef, useEffect } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TripActionModal } from './TripActionModal';

interface TripActionsProps {
  trip: { id: string; status: string; departure_time: string };
  onEdit: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onPostpone: (newDate: string) => void;
  onDelete: () => void;
  onViewDetail: () => void;
  actionLoading: boolean;
  canComplete: boolean;
  canCancelPostpone: boolean;
}

export function TripActions({
  trip,
  onEdit,
  onComplete,
  onCancel,
  onPostpone,
  onDelete,
  onViewDetail,
  actionLoading,
  canComplete,
  canCancelPostpone,
}: TripActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<'complete' | 'cancel' | 'delete' | 'postpone' | null>(null);
  const [postponeDate, setPostponeDate] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
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

  actions.push({ key: 'view', label: 'Ver detalle', variant: 'secondary', onClick: onViewDetail });

  if (isActive) {
    actions.push({ key: 'edit', label: 'Editar', variant: 'secondary', onClick: onEdit });
    if (canCancelPostpone) {
      actions.push({ key: 'postpone', label: 'Posponer', variant: 'secondary', className: '!bg-[#f59e0b] hover:!bg-[#d97706] !text-white', onClick: () => { setPostponeDate(''); setActiveAction('postpone'); } });
    }
    if (canComplete) {
      actions.push({ key: 'complete', label: 'Completar', variant: 'secondary', className: '!bg-[#10b981] hover:!bg-[#059669] !text-white', onClick: () => setActiveAction('complete') });
    }
    if (canCancelPostpone) {
      actions.push({ key: 'cancel', label: 'Cancelar', variant: 'destructive', onClick: () => setActiveAction('cancel') });
    }
  }
  actions.push({ key: 'delete', label: 'Eliminar', variant: 'destructive', onClick: () => setActiveAction('delete') });

  const handleConfirm = () => {
    if (activeAction === 'complete') { onComplete(); setActiveAction(null); }
    if (activeAction === 'cancel') { onCancel(); setActiveAction(null); }
    if (activeAction === 'delete') { onDelete(); setActiveAction(null); }
    if (activeAction === 'postpone') {
      if (postponeDate) {
        onPostpone(postponeDate);
        setActiveAction(null);
        setPostponeDate('');
      }
    }
  };

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
              onClick={() => setMenuOpen(!menuOpen)}
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
                    onClick={() => { action.onClick(); setMenuOpen(false); }}
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

      <TripActionModal
        open={activeAction === 'cancel'}
        title="Cancelar viaje"
        message="¿Estás seguro de cancelar este viaje? Esta acción no se puede deshacer."
        confirmLabel="Cancelar viaje"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={() => setActiveAction(null)}
      />

      <TripActionModal
        open={activeAction === 'complete'}
        title="¿Deseas marcar este viaje como completado?"
        message="Esta acción no podrá deshacerse."
        confirmLabel="Confirmar"
        variant="confirm"
        onConfirm={handleConfirm}
        onCancel={() => setActiveAction(null)}
      />

      <TripActionModal
        open={activeAction === 'delete'}
        title="Eliminar viaje"
        message="¿Estás seguro de eliminar este viaje? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={() => setActiveAction(null)}
      />

      <TripActionModal
        open={activeAction === 'postpone'}
        title="Posponer viaje"
        message="Selecciona la nueva fecha y hora de salida."
        confirmLabel="Guardar"
        variant="confirm"
        loading={actionLoading}
        onConfirm={handleConfirm}
        onCancel={() => { setActiveAction(null); setPostponeDate(''); }}
      >
        <input
          type="datetime-local"
          value={postponeDate}
          onChange={(e) => setPostponeDate(e.target.value)}
          className="w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3 py-2 text-xs font-[family-name:var(--font-body)] text-[var(--color-brand-navy)] bg-white outline-none focus:border-[var(--color-brand-cyan)]"
        />
      </TripActionModal>
    </div>
  );
}
