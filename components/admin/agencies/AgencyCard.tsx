'use client';

import { Building2, Pencil, Power, PowerOff } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { AgencyStatusBadge } from './AgencyStatusBadge';

export interface AgencyData {
  id: string;
  name: string;
  subdomain: string;
  email: string | null;
  phone: string | null;
  status: 'active' | 'inactive' | 'pending';
  tripCount: number;
  reservationCount: number;
}

interface AgencyCardProps {
  agency: AgencyData;
  onEdit: (agency: AgencyData) => void;
  onDeactivate: (agency: AgencyData) => void;
  onActivate: (agency: AgencyData) => void;
  activatingId?: string | null;
}

export function AgencyCard({ agency, onEdit, onDeactivate, onActivate, activatingId }: AgencyCardProps) {
  const isActive = agency.status === 'active';
  const isPending = agency.status === 'pending';

  return (
    <Card hover className="flex flex-col gap-4 h-full">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-[family-name:var(--font-heading)] font-bold text-[17px] text-[var(--color-brand-navy)] leading-tight truncate">
            {agency.name}
          </h3>
          {agency.email && (
            <p className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)] mt-0.5 truncate">
              {agency.email}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <AgencyStatusBadge status={agency.status} size="xs" />
            <Badge variant={agency.tripCount > 0 ? 'info' : 'inactive'} size="xs">
              {agency.tripCount} {agency.tripCount === 1 ? 'viaje' : 'viajes'}
            </Badge>
            {agency.reservationCount > 0 && (
              <Badge variant="warning" size="xs">
                {agency.reservationCount} {agency.reservationCount === 1 ? 'reserva' : 'reservas'}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(agency)}
        >
          <Pencil className="w-3.5 h-3.5" />
          Editar
        </Button>

        {isActive || isPending ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onDeactivate(agency)}
          >
            <PowerOff className="w-3.5 h-3.5" />
            Desactivar
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onActivate(agency)}
            loading={activatingId === agency.id}
            disabled={!!activatingId}
          >
            <Power className="w-3.5 h-3.5" />
            Activar
          </Button>
        )}
      </div>
    </Card>
  );
}
