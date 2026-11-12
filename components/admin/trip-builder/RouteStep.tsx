'use client';

import { MapPin } from 'lucide-react';
import type { Route } from '@/types';
import { Field } from '@/components/form';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

const inputClass =
  "w-full border-[1.5px] border-[#e5e7eb] rounded-xl px-3.5 py-2.5 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-navy)] bg-white outline-none transition-all duration-200 focus:border-[var(--color-brand-cyan)] focus:shadow-[0_0_0_3px_var(--color-cyan-ring)]";

/**
 * AS-TRIP-003: acepta el subconjunto de campos que realmente usa el
 * selector (el catálogo de agencia no incluye `created_by` ni métricas),
 * de modo que el admin puede seguir pasando `Route[]` completo.
 */
interface RouteStepProps {
  routes: Array<Pick<Route, 'id' | 'origin' | 'destination' | 'status'>>;
  selectedRouteId: string;
  onSelect: (routeId: string) => void;
  /**
   * Texto del estado vacío. Por defecto el del superadmin ("crea una
   * ruta"); la agencia no puede crear rutas, así que allí se explica que
   * la ruta global hay que pedirla al superadmin.
   */
  emptyMessage?: string;
}

export function RouteStep({
  routes,
  selectedRouteId,
  onSelect,
  emptyMessage = 'No hay rutas activas disponibles. Crea una ruta primero.',
}: RouteStepProps) {
  const activeRoutes = routes.filter((r) => r.status === 'active');
  const selectedRoute = routes.find((r) => r.id === selectedRouteId);

  if (activeRoutes.length === 0) {
    return <EmptyState icon={<MapPin className="w-8 h-8" />} message={emptyMessage} />;
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
            <div className="w-10 h-10 rounded-xl bg-[var(--color-cyan-bg)] flex items-center justify-center shrink-0">
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
