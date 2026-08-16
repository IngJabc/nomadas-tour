'use client';

import { PageHeader } from '@/components/ui/PageHeader';
import { AuditFeed } from '@/components/audit/AuditFeed';
import { useAuthUser } from '@/hooks/useAuthUser';
import { canAccessAdminAuditUi } from '@/lib/audit-ui-gate';

export default function AgencyAuditPage() {
  const { user, loading: authLoading } = useAuthUser();
  const allowed = canAccessAdminAuditUi(user);

  // Match AuthRoleGuard: return null while loading / unauthorized (UX only).
  if (authLoading || !allowed) {
    return null;
  }

  const agencyName =
    user?.role === 'agency' && user.agency_name?.trim()
      ? user.agency_name.trim()
      : 'Tu agencia';

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <PageHeader title="Auditoría" />
      <p className="mb-6 -mt-2 max-w-3xl font-[family-name:var(--font-body)] text-[14px] text-[var(--color-brand-muted)]">
        <span className="font-semibold text-[var(--color-brand-navy)]">
          {agencyName}
        </span>
        {' · '}
        solo actividad propia. Identificación nominal del actor: evolución
        futura.
      </p>
      <AuditFeed role="agency" agencyName={agencyName} />
    </main>
  );
}
