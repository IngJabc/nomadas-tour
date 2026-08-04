'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthUser } from '@/components/auth/AuthProvider';
import type { AppRole } from '@/lib/auth/types';

interface AuthRoleGuardProps {
  requiredRole: AppRole;
  children: ReactNode;
}

/**
 * UX-only route guard. Critical authorization remains in Express + RLS.
 */
export function AuthRoleGuard({ requiredRole, children }: AuthRoleGuardProps) {
  const { user, loading } = useAuthUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace('/login');
      return;
    }

    if (user.role !== requiredRole) {
      router.replace('/');
      return;
    }

    if (requiredRole === 'agency') {
      const agencyParam = searchParams.get('agency');
      if (agencyParam && user.agency_id !== agencyParam) {
        router.replace('/agency/trips?error=wrong-agency');
      }
    }
  }, [loading, user, requiredRole, router, searchParams]);

  if (!user || user.role !== requiredRole) {
    return null;
  }

  return <>{children}</>;
}
