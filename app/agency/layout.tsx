'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AgencySidebar } from '@/components/layout/AgencySidebar';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { subscribeToAgencies } from '@/lib/realtime/subscriptions';
import { logoutInactiveAgency } from '@/lib/auth/session-handler';
import { agencyApi } from '@/lib/api';
import { NotificationProvider } from '@/components/notifications/NotificationProvider';
import { AuthRoleGuard } from '@/components/auth/AuthRoleGuard';
import { useAuthUser } from '@/hooks/useAuthUser';
import type { CleanupFn } from '@/lib/realtime/subscriptions';
import { AgencyBrandingProvider } from '@/components/branding/AgencyBrandingProvider';

function AgencyLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuthUser();
  const cleanupRef = useRef<CleanupFn | null>(null);

  const handleLogout = async () => {
    try {
      await Promise.race([
        agencyApi.unlockAllUserSeats(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
    } catch { /* best-effort — TTL is the safety net */ }

    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  useEffect(() => {
    const agencyId = user?.agency_id;
    if (!agencyId) return;

    cleanupRef.current = subscribeToAgencies((payload) => {
      if (payload.eventType !== 'UPDATE') return;
      if (payload.agency.id !== agencyId) return;
      if (payload.agency.status !== 'inactive') return;
      logoutInactiveAgency();
    }, agencyId);

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [user?.agency_id]);

  return (
    <AgencyBrandingProvider>
      <NotificationProvider>
        <DashboardLayout sidebar={<AgencySidebar onLogout={handleLogout} />}>
          {children}
        </DashboardLayout>
      </NotificationProvider>
    </AgencyBrandingProvider>
  );
}

export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AuthRoleGuard requiredRole="agency">
        <AgencyLayoutInner>{children}</AgencyLayoutInner>
      </AuthRoleGuard>
    </Suspense>
  );
}
