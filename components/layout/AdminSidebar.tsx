"use client";

import { useMemo } from "react";
import {
  LayoutDashboard,
  Users,
  Calendar,
  Route,
  Building2,
  History,
  type LucideIcon,
} from "lucide-react";
import { PlatformLogoMark } from "@/components/brand/PlatformLogoMark";
import { useAuthUser } from "@/hooks/useAuthUser";
import { canAccessAdminAuditUi } from "@/lib/audit-ui-gate";
import { Sidebar } from "./Sidebar";

const BASE_NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/admin", label: "Panel", icon: LayoutDashboard },
  { href: "/admin/trips", label: "Viajes", icon: Calendar },
  { href: "/admin/bookings", label: "Pasajeros", icon: Users },
  { href: "/admin/routes", label: "Rutas", icon: Route },
  { href: "/admin/agencies", label: "Agencias", icon: Building2 },
];

const AUDIT_NAV_ITEM = {
  href: "/admin/audit",
  label: "Auditoría",
  icon: History,
} as const;

interface AdminSidebarProps {
  onLogout: () => void;
}

export function AdminSidebar({ onLogout }: AdminSidebarProps) {
  const { user } = useAuthUser();

  const navItems = useMemo(() => {
    // TEMPORARY UI GATE — Audit Trail (visibility only; API auth unchanged)
    if (canAccessAdminAuditUi(user)) {
      return [...BASE_NAV_ITEMS, AUDIT_NAV_ITEM];
    }
    return BASE_NAV_ITEMS;
  }, [user]);

  return (
    <Sidebar
      navItems={navItems}
      logo={<PlatformLogoMark size={40} priority />}
      brandSubtitle="Panel Admin"
      onLogout={onLogout}
      basePath="/admin"
    />
  );
}
