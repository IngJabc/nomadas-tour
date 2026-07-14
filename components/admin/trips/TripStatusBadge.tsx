'use client';

import { Badge } from '@/components/ui/Badge';

const STATUS_MAP: Record<string, { label: string; variant: 'active' | 'completed' | 'cancelled' | 'warning' }> = {
  active: { label: 'Activo', variant: 'active' },
  completed: { label: 'Completado', variant: 'completed' },
  cancelled: { label: 'Cancelado', variant: 'cancelled' },
  postponed: { label: 'Pospuesto', variant: 'warning' },
};

interface TripStatusBadgeProps {
  status: string;
  postponed?: boolean;
  size?: 'xs' | 'sm' | 'md';
}

export function TripStatusBadge({ status, postponed, size = 'sm' }: TripStatusBadgeProps) {
  if (postponed || status === 'postponed') {
    return <Badge variant="warning" size={size}>Pospuesto</Badge>;
  }
  const s = STATUS_MAP[status] ?? STATUS_MAP.active;

  return (
    <Badge variant={s.variant} size={size}>{s.label}</Badge>
  );
}
