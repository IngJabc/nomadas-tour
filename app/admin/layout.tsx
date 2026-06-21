'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/admin', label: 'Panel', icon: '📊' },
  { href: '/admin/bookings', label: 'Pasajeros', icon: '👥' },
  { href: '/admin/scan', label: 'Escáner QR', icon: '📷' },
  { href: '/admin/trips', label: 'Viajes', icon: '📋' },
  { href: '/admin/routes', label: 'Rutas', icon: '🗺️' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen flex">
      {/* Mobile hamburger trigger — visible only on small screens */}
      <button
        className={`lg:hidden fixed top-3 left-3 z-50 p-3 rounded-xl bg-brand-dark shadow-lg shadow-black/20 transition-opacity duration-150 ${
          drawerOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        onClick={() => setDrawerOpen(true)}
        aria-label="Abrir menú admin"
      >
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setDrawerOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-[220px] flex flex-col bg-brand-dark
          transform transition-transform duration-200
          ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:fixed
        `}
      >
        {/* Close button for mobile */}
        <button
          className="lg:hidden self-end p-3 text-white/60 hover:text-white"
          onClick={() => setDrawerOpen(false)}
          aria-label="Cerrar menú"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Logo */}
        <div className="px-6 pt-8 pb-4 flex flex-col items-center">
          <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-white font-bold text-lg font-['Montserrat',sans-serif]">
            N
          </div>
          <div className="mt-2 px-2 py-0.5 rounded bg-[rgba(0,212,255,0.2)]">
            <span className="font-['Poppins',sans-serif] font-semibold text-[10px] text-brand-cyan uppercase tracking-wider">
              Panel Admin
            </span>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-2 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = item.href === '/admin'
              ? pathname === '/admin'
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setDrawerOpen(false)}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm rounded-r-lg transition-colors font-['Poppins',sans-serif] font-medium border-l-[3px] border-solid ${
                  active
                    ? 'bg-white/10 text-white border-l-brand-cyan'
                    : 'bg-transparent text-white/65 hover:bg-white/5 hover:text-white border-l-transparent'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Back to site */}
        <div className="px-6 py-6 border-t border-white/10">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 font-['Poppins',sans-serif] font-medium text-xs text-white/60 hover:text-white"
            onClick={() => setDrawerOpen(false)}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Volver al sitio
          </Link>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 lg:ml-[220px] min-h-screen bg-slate-100 pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  );
}
