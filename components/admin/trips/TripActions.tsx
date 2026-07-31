'use client';

import { ResponsiveActions, type ResponsiveActionItem } from '@/components/ui/ResponsiveActions';

interface TripActionsProps {
  trip: { id: string; status: string; departure_time: string };
  onEdit: () => void;
  onAction: (tripId: string, action: string) => void;
  actionLoading: boolean;
  canComplete: boolean;
  canCancelPostpone: boolean;
  hasReservations: boolean;
  onMenuToggle?: (open: boolean) => void;
}

export function TripActions({
  trip,
  onEdit,
  onAction,
  actionLoading,
  canComplete,
  canCancelPostpone,
  hasReservations,
  onMenuToggle,
}: TripActionsProps) {
  const isActive = trip.status === 'active';

  const actions: ResponsiveActionItem[] = [];

  if (trip.status !== 'cancelled') {
    actions.push({
      key: 'view',
      label: 'Ver detalle',
      variant: 'secondary',
      onClick: () => onAction(trip.id, 'view'),
    });
  }

  if (isActive) {
    if (!hasReservations) {
      actions.push({
        key: 'edit',
        label: 'Editar',
        variant: 'secondary',
        onClick: onEdit,
      });
    }
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
  if (trip.status === 'cancelled' || trip.status === 'completed') {
    actions.push({
      key: 'archive',
      label: 'Archivar',
      variant: 'destructive',
      onClick: () => onAction(trip.id, 'archive'),
    });
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <ResponsiveActions
        actions={actions}
        disabled={actionLoading}
        onMenuToggle={onMenuToggle}
      />
    </div>
  );
}
