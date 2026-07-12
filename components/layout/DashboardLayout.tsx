'use client';

interface DashboardLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export function DashboardLayout({ sidebar, children }: DashboardLayoutProps) {
  return (
    <div className="min-h-screen flex">
      {sidebar}
      <main className="flex-1 lg:ml-[220px] min-h-screen bg-[var(--color-page-bg)] pt-14 lg:pt-0 overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
