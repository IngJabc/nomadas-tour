'use client';

import { MapPin } from 'lucide-react';
import type { Route } from '@/types';
import { Field } from '@/components/form';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

const inputClass =
  "w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-white outline-none transition-all duration-200 focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_rgba(0,212,255,0.15)]";

interface RouteStepProps {
  routes: Route[];
  selectedRouteId: string;
  onSelect: (routeId: string) => void;
}

export function RouteStep({ routes, selectedRouteId, onSelect }: RouteStepProps) {
  const activeRoutes = routes.filter((r) => r.status === 'active');
  const selectedRoute = routes.find((r) => r.id === selectedRouteId);

  if (activeRoutes.length === 0) {
    return (
      <EmptyState
        icon={<MapPin className="w-8 h-8" />}
        message="No hay rutas activas disponibles. Crea una ruta primero."
      />
    );
  }

  return (
    <div className="space-y-5">
      <Field label="Seleccionar ruta">
        <select
          value={selectedRouteId}
          onChange={(e) => onSelect(e.target.value)}
          className={inputClass}
        >
          <option value="">Seleccione una ruta</option>
          {activeRoutes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.origin} → {route.destination}
            </option>
          ))}
        </select>
      </Field>

      {selectedRoute && (
        <Card>
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5 text-[var(--color-brand-cyan)]" />
            </div>
            <div>
              <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                {selectedRoute.origin} → {selectedRoute.destination}
              </p>
              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)]">
                Ruta seleccionada
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
