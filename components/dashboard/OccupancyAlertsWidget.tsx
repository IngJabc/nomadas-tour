'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, Bus, Clock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDateTimeShort } from '@/lib/timezone';

export interface OccupancyAlertItem {
  trip_id: string;
  alert_type: 'near_full' | 'underbooked';
  origin: string;
  destination: string;
  departure_time: string;
  occupancy_pct: number;
  capacity: number;
  reserved: number;
  available: number;
  /** F4-004 — derived T-24h urgency. */
  urgency?: boolean;
}

interface OccupancyAlertsWidgetProps {
  alerts: OccupancyAlertItem[];
  loading?: boolean;
}

function alertLabel(type: OccupancyAlertItem['alert_type']) {
  return type === 'near_full' ? 'Casi lleno' : 'Pocas reservas';
}

export function OccupancyAlertsWidget({
  alerts,
  loading = false,
}: OccupancyAlertsWidgetProps) {
  return (
    <Card className="p-6">
      <SectionTitle className="mb-6">Alertas de ocupación</SectionTitle>

      {loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 w-full rounded-[16px]" />
          <Skeleton className="h-24 w-full rounded-[16px]" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center text-center py-8 px-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
            <Bus className="w-6 h-6 text-[var(--color-brand-muted)]" strokeWidth={1.75} />
          </div>
          <p className="font-[family-name:var(--font-heading)] font-bold text-[16px] text-[var(--color-brand-navy)] mb-2">
            No hay alertas de ocupación
          </p>
          <p className="font-[family-name:var(--font-body)] font-normal text-[14px] text-[var(--color-brand-muted)] mb-6 max-w-md">
            Cuando un viaje asignado esté casi lleno o con pocas reservas, aparecerá
            aquí para que puedas actuar.
          </p>
          <Link href="/agency/trips">
            <Button variant="primary" size="md">
              Ver viajes
            </Button>
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {alerts.map((alert) => {
            const isUrgent = alert.urgency === true;
            return (
              <li key={alert.trip_id}>
                <Link
                  href={`/agency/trips/${alert.trip_id}/passengers`}
                  className="no-underline block"
                >
                  <Card
                    hover
                    borderLeft={isUrgent}
                    borderColor={isUrgent ? '#ef4444' : undefined}
                    className={`p-6${isUrgent ? ' bg-[#fef2f2]' : ''}`}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge
                            variant={
                              alert.alert_type === 'near_full' ? 'warning' : 'info'
                            }
                          >
                            {alertLabel(alert.alert_type)}
                          </Badge>
                          {isUrgent ? (
                            <Badge
                              variant="cancelled"
                              className="inline-flex items-center gap-1"
                            >
                              <Clock className="w-3 h-3" strokeWidth={1.75} />
                              Sale pronto
                            </Badge>
                          ) : (
                            <AlertTriangle
                              className="w-4 h-4 text-[var(--color-brand-muted)]"
                              strokeWidth={1.75}
                            />
                          )}
                        </div>
                        <p className="font-[family-name:var(--font-body)] font-semibold text-[17px] text-[var(--color-brand-navy)]">
                          {alert.destination}
                        </p>
                        <p className="font-[family-name:var(--font-body)] font-normal text-[13px] text-[var(--color-brand-muted)] mt-1">
                          {formatDateTimeShort(alert.departure_time)}
                        </p>
                        <div className="flex flex-wrap gap-4 mt-4">
                          <div>
                            <p className="font-[family-name:var(--font-body)] font-normal text-[12px] uppercase text-[var(--color-brand-muted)]">
                              Ocupación
                            </p>
                            <p className="font-[family-name:var(--font-heading)] font-extrabold text-[24px] text-[var(--color-brand-navy)] tabular-nums">
                              {alert.occupancy_pct}%
                            </p>
                          </div>
                          <div>
                            <p className="font-[family-name:var(--font-body)] font-normal text-[12px] uppercase text-[var(--color-brand-muted)]">
                              Capacidad
                            </p>
                            <p className="font-[family-name:var(--font-body)] font-semibold text-[18px] text-[var(--color-brand-navy)] tabular-nums">
                              {alert.capacity}
                            </p>
                          </div>
                          <div>
                            <p className="font-[family-name:var(--font-body)] font-normal text-[12px] uppercase text-[var(--color-brand-muted)]">
                              Reservados
                            </p>
                            <p className="font-[family-name:var(--font-body)] font-semibold text-[18px] text-[var(--color-brand-navy)] tabular-nums">
                              {alert.reserved}
                            </p>
                          </div>
                          <div>
                            <p className="font-[family-name:var(--font-body)] font-normal text-[12px] uppercase text-[var(--color-brand-muted)]">
                              Disponibles
                            </p>
                            <p className="font-[family-name:var(--font-body)] font-semibold text-[18px] text-[var(--color-brand-navy)] tabular-nums">
                              {alert.available}
                            </p>
                          </div>
                        </div>
                      </div>
                      <span className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 font-[family-name:var(--font-body)] font-semibold text-[14px] text-white bg-[var(--color-brand-cyan)]">
                        Ver viaje
                        <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                      </span>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
