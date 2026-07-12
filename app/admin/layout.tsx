'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AdminSidebar } from '@/components/layout/AdminSidebar';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <DashboardLayout sidebar={<AdminSidebar onLogout={handleLogout} />}>
      {children}
    </DashboardLayout>
  );
}
