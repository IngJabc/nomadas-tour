'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
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
        className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-lg"
        style={{ background: 'var(--color-brand-dark)' }}
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
          fixed inset-y-0 left-0 z-40 w-[220px] flex flex-col
          transform transition-transform duration-200
          ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:fixed
        `}
        style={{ background: 'var(--color-brand-dark)' }}
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
          <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-white font-bold text-lg" style={{ fontFamily: 'var(--font-heading)' }}>
            N
          </div>
          <div className="mt-2 px-2 py-0.5 rounded" style={{ background: 'rgba(8,142,184,0.2)' }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 10, color: 'var(--color-brand-cyan)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Panel Admin
            </span>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-2 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setDrawerOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm rounded-r-lg transition-colors"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 500,
                  fontSize: 14,
                  color: active ? '#ffffff' : 'rgba(255,255,255,0.65)',
                  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                  borderLeft: active ? '3px solid var(--color-brand-cyan)' : '3px solid transparent',
                  borderRadius: '0 8px 8px 0',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; }}}
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
            className="inline-flex items-center gap-1.5"
            style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}
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
      <main className="flex-1 lg:ml-[220px] min-h-screen" style={{ background: '#f1f5f9' }}>
        {children}
      </main>
    </div>
  );
}
