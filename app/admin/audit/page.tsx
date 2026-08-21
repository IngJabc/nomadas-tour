'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { AuditFeed } from '@/components/audit/AuditFeed';
import { useAuthUser } from '@/hooks/useAuthUser';
import { canAccessAdminAuditUi } from '@/lib/audit-ui-gate';
import { adminApi } from '@/lib/api';

export default function AdminAuditPage() {
  const { user } = useAuthUser();
  const allowed = canAccessAdminAuditUi(user);

  const [agencies, setAgencies] = useState<{ id: string; name: string }[]>([]);
  const [routes, setRoutes] = useState<
    { id: string; origin: string; destination: string }[]
  >([]);

  useEffect(() => {
    // TEMPORARY UI GATE — do not prefetch lookups or mount feed for others.
    if (!allowed) return;

    let cancelled = false;
    (async () => {
      try {
        const [agencyRows, routeRows] = await Promise.all([
          adminApi.listAgencies(),
          adminApi.listRoutes(),
        ]);
        if (cancelled) return;
        setAgencies(
          (agencyRows ?? []).map((a: { id: string; name: string }) => ({
            id: a.id,
            name: a.name,
          })),
        );
        setRoutes(
          (routeRows ?? []).map(
            (r: { id: string; origin: string; destination: string }) => ({
              id: r.id,
              origin: r.origin,
              destination: r.destination,
            }),
          ),
        );
      } catch {
        /* Lookups are best-effort; feed still works with short IDs */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const agencyLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of agencies) map[a.id] = a.name;
    return map;
  }, [agencies]);

  const routeLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of routes) map[r.id] = `${r.origin} → ${r.destination}`;
    return map;
  }, [routes]);

  // Match AuthRoleGuard (AUD-019.3): do not blank on auth revalidation.
  // Returning null while loading flashed white when switching tabs/routes.
  if (!allowed) {
    return null;
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <PageHeader title="Auditoría" />
      <p className="mb-6 -mt-2 max-w-3xl font-[family-name:var(--font-body)] text-[14px] text-[var(--color-brand-muted)]">
        Actividad reciente del sistema. Los nombres de personas no se muestran
        en esta versión — solo rol, agencia e identificadores técnicos.
      </p>
      <AuditFeed
        role="superadmin"
        singleExpand
        agencies={agencies}
        agencyLabels={agencyLabels}
        routeLabels={routeLabels}
      />
    </main>
  );
}
