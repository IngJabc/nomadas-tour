'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AgencySidebar } from '@/components/layout/AgencySidebar';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <DashboardLayout sidebar={<AgencySidebar onLogout={handleLogout} />}>
      {children}
    </DashboardLayout>
  );
}
