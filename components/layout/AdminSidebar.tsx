'use client';

import {
  LayoutDashboard,
  Users,
  QrCode,
  Calendar,
  Route,
  Building2,
  type LucideIcon,
} from 'lucide-react';
import { Sidebar } from './Sidebar';

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/admin', label: 'Panel', icon: LayoutDashboard },
  { href: '/admin/bookings', label: 'Pasajeros', icon: Users },
  { href: '/admin/scan', label: 'Escáner QR', icon: QrCode },
  { href: '/admin/trips', label: 'Viajes', icon: Calendar },
  { href: '/admin/routes', label: 'Rutas', icon: Route },
  { href: '/admin/agencies', label: 'Agencias', icon: Building2 },
];

interface AdminSidebarProps {
  onLogout: () => void;
}

export function AdminSidebar({ onLogout }: AdminSidebarProps) {
  return (
    <Sidebar
      navItems={NAV_ITEMS}
      brandLabel="Panel Admin"
      onLogout={onLogout}
      basePath="/admin"
    />
  );
}
