'use client';

import { LayoutDashboard, ClipboardList, QrCode, Bus, type LucideIcon } from 'lucide-react';
import { Sidebar } from './Sidebar';

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/agency', label: 'Panel', icon: LayoutDashboard },
  { href: '/agency/trips', label: 'Mis viajes', icon: Bus },
  { href: '/agency/reservations', label: 'Reservas', icon: ClipboardList },
  { href: '/agency/scan', label: 'Escáner QR', icon: QrCode },
];

interface AgencySidebarProps {
  onLogout: () => void;
}

export function AgencySidebar({ onLogout }: AgencySidebarProps) {
  return (
    <Sidebar
      navItems={NAV_ITEMS}
      brandLabel="Panel Agencia"
      onLogout={onLogout}
      basePath="/agency"
    />
  );
}
