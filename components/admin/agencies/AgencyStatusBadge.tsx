import { Badge } from '@/components/ui/Badge';

const STATUS_MAP: Record<string, { label: string; variant: 'active' | 'inactive' | 'warning' }> = {
  active: { label: 'Activa', variant: 'active' },
  inactive: { label: 'Inactiva', variant: 'inactive' },
  pending: { label: 'Pendiente', variant: 'warning' },
};

interface AgencyStatusBadgeProps {
  status: string;
  size?: 'xs' | 'sm' | 'md';
}

export function AgencyStatusBadge({ status, size = 'sm' }: AgencyStatusBadgeProps) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.active;
  return <Badge variant={s.variant} size={size}>{s.label}</Badge>;
}
