'use client';

import { MapPin, Calendar, Bus, Building2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { formatInTimezone } from '@/lib/timezone';
import type { TripBuilderState } from '@/hooks/useTripBuilderReducer';
import type { Route } from '@/types';

interface ReviewStepProps {
  state: TripBuilderState;
  routes: Route[];
  agencies: { id: string; name: string }[];
}

const VEHICLE_LABELS: Record<string, string> = {
  bus: 'Autobús (31 puestos)',
  kia: 'KIA (10 puestos)',
};

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0 mt-0.5">
        <div className="w-4 h-4 text-[var(--color-brand-cyan)]">{icon}</div>
      </div>
      <div>
        <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
          {label}
        </p>
        <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)] mt-0.5">
          {value}
        </p>
      </div>
    </div>
  );
}

export function ReviewStep({ state, routes, agencies }: ReviewStepProps) {
  const route = routes.find((r) => r.id === state.route_id);
  const selectedAgencies = agencies.filter((a) =>
    state.agency_ids.includes(a.id),
  );

  const dt = state.departure_time
    ? formatInTimezone(state.departure_time)
    : '';

  return (
    <div className="space-y-4 max-w-lg">
      <Card>
        <div className="space-y-4">
          <InfoRow
            icon={<MapPin className="w-4 h-4" />}
            label="Ruta"
            value={
              route
                ? `${route.origin} → ${route.destination}`
                : 'No seleccionada'
            }
          />

          <div className="w-full h-px bg-[rgba(0,0,0,0.06)]" />

          <InfoRow
            icon={<Calendar className="w-4 h-4" />}
            label="Fecha y hora de salida"
            value={dt || 'No definida'}
          />

          <div className="w-full h-px bg-[rgba(0,0,0,0.06)]" />

          <InfoRow
            icon={<Bus className="w-4 h-4" />}
            label="Vehículo"
            value={
              state.vehicle_type
                ? VEHICLE_LABELS[state.vehicle_type]
                : 'No seleccionado'
            }
          />

          <div className="w-full h-px bg-[rgba(0,0,0,0.06)]" />

          <InfoRow
            icon={<Building2 className="w-4 h-4" />}
            label={`Agencias (${selectedAgencies.length})`}
            value={
              selectedAgencies.length > 0
                ? selectedAgencies.map((a) => a.name).join(', ')
                : 'No seleccionadas'
            }
          />
        </div>
      </Card>
    </div>
  );
}
