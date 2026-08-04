'use client';

import { LayoutDashboard, ClipboardList, QrCode, Bus, Bell, Palette, type LucideIcon } from 'lucide-react';
import { PlatformLogoMark } from '@/components/brand/PlatformLogoMark';
import { useAgencyBranding } from '@/components/branding/AgencyBrandingProvider';
import { useAuthUser } from '@/hooks/useAuthUser';
import { Sidebar } from './Sidebar';

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/agency', label: 'Panel', icon: LayoutDashboard },
  { href: '/agency/trips', label: 'Mis viajes', icon: Bus },
  { href: '/agency/reservations', label: 'Reservas', icon: ClipboardList },
  { href: '/agency/scan', label: 'Escáner QR', icon: QrCode },
  { href: '/agency/settings/branding', label: 'Branding', icon: Palette },
  { href: '/agency/settings/notifications', label: 'Notificaciones', icon: Bell },
];

interface AgencySidebarProps {
  onLogout: () => void;
}

function AgencySidebarLogo({
  logoUrl,
  agencyName,
}: {
  logoUrl: string | null;
  agencyName: string;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`Logo de ${agencyName}`}
        width={40}
        height={40}
        className="w-10 h-10 object-contain"
      />
    );
  }

  return <PlatformLogoMark size={40} priority />;
}

export function AgencySidebar({ onLogout }: AgencySidebarProps) {
  const { branding } = useAgencyBranding();
  const { user } = useAuthUser();
  const agencyName =
    user?.role === 'agency' && user.agency_name?.trim()
      ? user.agency_name.trim()
      : 'Agencia';

  return (
    <Sidebar
      navItems={NAV_ITEMS}
      logo={
        <AgencySidebarLogo
          logoUrl={branding?.logo_url ?? null}
          agencyName={agencyName}
        />
      }
      brandTitle={agencyName}
      brandSubtitle="Panel Agencia"
      onLogout={onLogout}
      basePath="/agency"
    />
  );
}
