'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { AuditEventCard } from '@/components/audit/AuditEventCard';
import {
  AuditFilters,
  defaultAuditFilters,
  filtersToQueryParams,
  hasActiveNonDateFilters,
  type AuditFilterState,
} from '@/components/audit/AuditFilters';
import type { AuditRoleView } from '@/components/audit/AuditEventDetail';
import { Button } from '@/components/ui/Button';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { adminApi, agencyApi } from '@/lib/api';
import type { AuditEventDTO, AuditQueryParams } from '@/types/audit';

interface AuditFeedProps {
  role: AuditRoleView;
  agencyName?: string | null;
  agencies?: { id: string; name: string }[];
  agencyLabels?: Record<string, string>;
  routeLabels?: Record<string, string>;
}

function mergeUnique(
  existing: AuditEventDTO[],
  incoming: AuditEventDTO[],
): AuditEventDTO[] {
  const seen = new Set(existing.map((e) => e.id));
  const merged = [...existing];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

export function AuditFeed({
  role,
  agencyName,
  agencies = [],
  agencyLabels,
  routeLabels,
}: AuditFeedProps) {
  const [filters, setFilters] = useState<AuditFilterState>(defaultAuditFilters);
  const [items, setItems] = useState<AuditEventDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const requestGen = useRef(0);

  const doFetch = useCallback(
    async (opts: {
      params: AuditQueryParams;
      append: boolean;
      soft?: boolean;
    }) => {
      const gen = ++requestGen.current;
      try {
        setFetchError(null);
        if (opts.append) setLoadingMore(true);
        else if (opts.soft) setRefreshing(true);
        else setLoading(true);

        const data =
          role === 'superadmin'
            ? await adminApi.listAudit(opts.params)
            : await agencyApi.listAudit(opts.params);

        if (gen !== requestGen.current) return;

        setItems((prev) =>
          opts.append ? mergeUnique(prev, data.items) : data.items,
        );
        setNextCursor(data.next_cursor);
      } catch {
        if (gen !== requestGen.current) return;
        if (!opts.append) setItems([]);
        setFetchError(
          'No se pudo cargar la auditoría. Intenta de nuevo.',
        );
      } finally {
        if (gen === requestGen.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [role],
  );

  const reloadFirstPage = useCallback(
    (state: AuditFilterState, soft = false) => {
      const params = filtersToQueryParams(state, role);
      if (!params) {
        setItems([]);
        setNextCursor(null);
        setLoading(false);
        setFetchError(null);
        return;
      }
      void doFetch({ params, append: false, soft });
    },
    [doFetch, role],
  );

  useEffect(() => {
    reloadFirstPage(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on filter identity changes via handler
  }, [filters]);

  const onFiltersChange = (next: AuditFilterState) => {
    setFilters(next);
  };

  const onLoadMore = () => {
    if (!nextCursor || loadingMore) return;
    const base = filtersToQueryParams(filters, role);
    if (!base) return;
    void doFetch({
      params: { ...base, cursor: nextCursor },
      append: true,
    });
  };

  const filteredEmpty = hasActiveNonDateFilters(filters);

  return (
    <div className="space-y-6">
      <AuditFilters
        role={role}
        value={filters}
        onChange={onFiltersChange}
        agencies={agencies}
      />

      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={refreshing}
          onClick={() => reloadFirstPage(filters, true)}
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Actualizar
        </Button>
      </div>

      {fetchError && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3"
          role="alert"
        >
          <p className="text-[14px] text-[#ef4444]">{fetchError}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => reloadFirstPage(filters)}
          >
            Reintentar
          </Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Cargando auditoría">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : items.length === 0 && !fetchError ? (
        <EmptyState
          icon={<History strokeWidth={1.75} />}
          message={
            filteredEmpty
              ? 'No hay actividad para los filtros seleccionados.'
              : 'No hay actividad registrada todavía.'
          }
          action={
            filteredEmpty
              ? {
                  label: 'Limpiar filtros',
                  onClick: () => setFilters(defaultAuditFilters()),
                }
              : undefined
          }
        />
      ) : (
        <div className="relative space-y-4">
          <div
            className="absolute bottom-0 left-[19px] top-0 hidden w-px bg-slate-200 md:block"
            aria-hidden
          />
          <ol className="space-y-4">
            {items.map((event) => (
              <li key={event.id} className="relative md:pl-10">
                <span
                  className="absolute left-[15px] top-6 hidden h-2.5 w-2.5 rounded-full bg-[var(--color-brand-cyan)] md:block"
                  aria-hidden
                />
                <AuditEventCard
                  event={event}
                  role={role}
                  agencyName={agencyName}
                  agencyLabels={agencyLabels}
                  routeLabels={routeLabels}
                />
              </li>
            ))}
          </ol>

          {nextCursor ? (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="secondary"
                loading={loadingMore}
                onClick={onLoadMore}
              >
                Cargar más
              </Button>
            </div>
          ) : (
            items.length > 0 && (
              <p className="py-2 text-center text-[13px] text-[var(--color-brand-muted)]">
                No hay más actividad
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
