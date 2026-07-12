'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { X, Menu, LogOut, ArrowLeft, type LucideIcon } from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface SidebarProps {
  navItems: NavItem[];
  brandLabel: string;
  onLogout: () => void;
  backLink?: { href: string; label: string };
  basePath: string;
}

export function Sidebar({
  navItems,
  brandLabel,
  onLogout,
  backLink = { href: '/', label: 'Volver al sitio' },
  basePath,
}: SidebarProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === basePath) return pathname === basePath;
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className={cn(
          'lg:hidden fixed top-3 left-3 z-50 p-3 rounded-xl',
          'bg-[var(--color-brand-dark)] shadow-lg shadow-black/20',
          'transition-opacity duration-150',
          drawerOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        )}
        onClick={() => setDrawerOpen(true)}
        aria-label="Abrir menú"
      >
        <Menu className="w-5 h-5 text-white" />
      </button>

      {/* Mobile overlay */}
      {drawerOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-[220px] flex flex-col',
          'bg-[var(--color-brand-dark)]',
          'transform transition-transform duration-200',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0 lg:fixed'
        )}
      >
        {/* Close button mobile */}
        <button
          className="lg:hidden self-end p-3 text-white/60 hover:text-white"
          onClick={() => setDrawerOpen(false)}
          aria-label="Cerrar menú"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Logo */}
        <div className="px-6 pt-8 pb-4 flex flex-col items-center">
          <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-white font-bold text-lg font-[family-name:var(--font-heading)]">
            N
          </div>
          <div className="mt-2 px-2 py-0.5 rounded bg-[rgba(0,212,255,0.2)]">
            <span className="font-[family-name:var(--font-body)] font-semibold text-[10px] text-[var(--color-brand-cyan)] uppercase tracking-wider">
              {brandLabel}
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-2 flex flex-col gap-1">
          {navItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setDrawerOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 text-sm rounded-r-lg transition-colors',
                  'font-[family-name:var(--font-body)] font-medium border-l-[3px] border-solid',
                  active
                    ? 'bg-white/10 text-white border-l-[var(--color-brand-cyan)]'
                    : 'bg-transparent text-white/65 hover:bg-white/5 hover:text-white border-l-transparent'
                )}
              >
                <Icon className="w-5 h-5 shrink-0" strokeWidth={1.5} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-6 py-6 border-t border-white/10 flex flex-col gap-3">
          <Link
            href={backLink.href}
            className="inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] font-medium text-xs text-white/60 hover:text-white"
            onClick={() => setDrawerOpen(false)}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {backLink.label}
          </Link>
          <button
            onClick={() => {
              setDrawerOpen(false);
              onLogout();
            }}
            className="inline-flex items-center gap-1.5 font-[family-name:var(--font-body)] font-medium text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  );
}
