'use client';

import { ResponsiveActions, type ResponsiveActionItem } from '@/components/ui/ResponsiveActions';

interface TripActionsProps {
  trip: { id: string; status: string; departure_time: string };
  onEdit: () => void;
  onAction: (tripId: string, action: string) => void;
  actionLoading: boolean;
  canComplete: boolean;
  canCancelPostpone: boolean;
  canAddAgency?: boolean;
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
  canAddAgency,
  hasReservations,
  onMenuToggle,
}: TripActionsProps) {
  const isActive = trip.status === 'active';
  const showAddAgency = canAddAgency ?? canCancelPostpone;

  const actions: ResponsiveActionItem[] = [];

  if (trip.status !== 'cancelled') {
    actions.push({
      key: 'view',
      label: 'Ver detalle',
      variant: 'secondary',
      className:
        '!bg-[var(--color-brand-navy)] hover:!bg-[var(--color-brand-mid)] !text-white',
      onClick: () => onAction(trip.id, 'view'),
    });
  }

  if (isActive) {
    if (!hasReservations) {
      actions.push({
        key: 'edit',
        label: 'Editar',
        variant: 'secondary',
        className:
          '!bg-[var(--color-brand-blue)] hover:!bg-[#0066cc] !text-white',
        onClick: onEdit,
      });
    }
    if (showAddAgency) {
      actions.push({
        key: 'add_agency',
        label: 'Agregar agencia',
        variant: 'secondary',
        className:
          '!bg-[var(--color-brand-cyan)] hover:!bg-[var(--color-brand-blue)] !text-white',
        onClick: () => onAction(trip.id, 'add_agency'),
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
        className: '!bg-[#ef4444] hover:!bg-[#dc2626] !text-white',
        onClick: () => onAction(trip.id, 'cancel'),
      });
    }
  }
  if (trip.status === 'cancelled' || trip.status === 'completed') {
    actions.push({
      key: 'archive',
      label: 'Archivar',
      variant: 'destructive',
      className: '!bg-[#6b7280] hover:!bg-[#4b5563] !text-white',
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
