'use client';

import { MapPin, Pencil, Power, PowerOff, AlertTriangle, Lock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';

export interface RouteData {
  id: string;
  origin: string;
  destination: string;
  status: 'active' | 'inactive';
  tripCount: number;
  reservationCount: number;
}

interface RouteCardProps {
  route: RouteData;
  onEdit: (route: RouteData) => void;
  onDeactivate: (route: RouteData) => void;
  onActivate: (route: RouteData) => void;
  activatingId?: string | null;
}

export function RouteCard({ route, onEdit, onDeactivate, onActivate, activatingId }: RouteCardProps) {
  const hasTrips = route.tripCount > 0;
  const hasReservations = route.reservationCount > 0;
  const isActive = route.status === 'active';

  const editDisabled = hasReservations;
  const deactivateDisabled = hasTrips && isActive;

  return (
    <Card hover className="flex flex-col gap-4 h-full">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5 text-[var(--color-brand-cyan)]" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-[family-name:var(--font-heading)] font-bold text-[17px] text-[var(--color-brand-navy)] leading-tight">
            {route.destination}
          </h3>
          <p className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)] mt-0.5">
            Desde {route.origin}
          </p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant={isActive ? (hasTrips ? 'info' : 'inactive') : 'inactive'} size="xs">
              {isActive ? 'Activa' : 'Inactiva'}
            </Badge>
            <Badge variant={hasTrips ? 'info' : 'inactive'} size="xs">
              {route.tripCount} {route.tripCount === 1 ? 'viaje' : 'viajes'}
            </Badge>
            {hasReservations && (
              <Badge variant="warning" size="xs">
                {route.reservationCount} {route.reservationCount === 1 ? 'reserva' : 'reservas'}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        {editDisabled ? (
          <Tooltip content="No puedes editar esta ruta porque tiene reservas asociadas.">
            <Button
              variant="ghost"
              size="sm"
              disabled
              title="No puedes editar esta ruta porque tiene reservas asociadas."
            >
              <Lock className="w-3.5 h-3.5" />
              Editar
            </Button>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(route)}
          >
            <Pencil className="w-3.5 h-3.5" />
            Editar
          </Button>
        )}

        {isActive ? (
          deactivateDisabled ? (
            <Tooltip content="No puedes desactivar esta ruta porque tiene viajes activos. Cancela o completa los viajes primero.">
              <Button
                variant="destructive"
                size="sm"
                disabled
                title="No puedes desactivar esta ruta porque tiene viajes activos."
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Desactivar
              </Button>
            </Tooltip>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDeactivate(route)}
            >
              <PowerOff className="w-3.5 h-3.5" />
              Desactivar
            </Button>
          )
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onActivate(route)}
            loading={activatingId === route.id}
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
