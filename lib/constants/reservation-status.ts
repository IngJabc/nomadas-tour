export const RESERVATION_STATUS_STYLES: Record<
  string,
  { label: string; variant: 'confirmed' | 'boarded' | 'cancelled' | 'warning' | 'inactive' }
> = {
  confirmed: { label: 'Confirmada', variant: 'confirmed' },
  boarded: { label: 'Abordado', variant: 'boarded' },
  cancelled: { label: 'Cancelada', variant: 'cancelled' },
  partial: { label: 'Parcial', variant: 'warning' },
  completed: { label: 'Completada', variant: 'inactive' },
};
