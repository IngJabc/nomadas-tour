'use client';

import { MapPin, Pencil, Trash2, AlertTriangle, Lock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';

export interface RouteData {
  id: string;
  origin: string;
  destination: string;
  tripCount: number;
  reservationCount: number;
}

interface RouteCardProps {
  route: RouteData;
  onEdit: (route: RouteData) => void;
  onDelete: (route: RouteData) => void;
}

export function RouteCard({ route, onEdit, onDelete }: RouteCardProps) {
  const hasTrips = route.tripCount > 0;
  const hasReservations = route.reservationCount > 0;

  const editDisabled = hasReservations;
  const deleteDisabled = hasTrips;

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
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
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

        {deleteDisabled ? (
          <Tooltip content="No puedes eliminar esta ruta porque tiene viajes asociados.">
            <Button
              variant="destructive"
              size="sm"
              disabled
              title="No puedes eliminar esta ruta porque tiene viajes asociados."
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Eliminar
            </Button>
          </Tooltip>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onDelete(route)}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Eliminar
          </Button>
        )}
      </div>
    </Card>
  );
}
