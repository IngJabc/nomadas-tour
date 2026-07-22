'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AgencySidebar } from '@/components/layout/AgencySidebar';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { subscribeToAgencies } from '@/lib/realtime/subscriptions';
import { logoutInactiveAgency } from '@/lib/auth/session-handler';
import { agencyApi } from '@/lib/api';
import type { CleanupFn } from '@/lib/realtime/subscriptions';

export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
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
    let cancelled = false;
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const agencyId = data.user?.user_metadata?.agency_id;
      if (!agencyId) return;

      cleanupRef.current = subscribeToAgencies((payload) => {
        if (payload.eventType !== 'UPDATE') return;
        if (payload.agency.id !== agencyId) return;
        if (payload.agency.status !== 'inactive') return;
        logoutInactiveAgency();
      }, agencyId);
    });

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return (
    <DashboardLayout sidebar={<AgencySidebar onLogout={handleLogout} />}>
      {children}
    </DashboardLayout>
  );
}
