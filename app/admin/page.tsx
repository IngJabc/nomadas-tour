"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Calendar,
  Route,
  Building2,
  ArrowRight,
  Users,
  Ticket,
  UserCheck,
} from "lucide-react";
import { adminApi } from "@/lib/api";
import { subscribeToTripSeats } from "@/lib/realtime/subscriptions";
import { getGreeting } from "@/lib/utils/greeting";
import { Topbar } from "@/components/layout/Topbar";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { ActivityWidget } from "@/components/dashboard/ActivityWidget";
import { Timeline } from "@/components/dashboard/Timeline";
import { ReservationChart } from "@/components/dashboard/charts/ReservationChart";
import { OccupancyChart } from "@/components/dashboard/charts/OccupancyChart";

interface DashboardData {
  total_agencies: number;
  active_agencies: number;
  total_trips: number;
  active_trips: number;
  total_routes: number;
  total_reservations: number;
  today_reservations: number;
  pending_boarding_passengers: number;
  upcoming_trips: {
    id: string;
    departure_time: string;
    route: { origin: string; destination: string } | null;
    capacity: number;
    available_seats: number;
    reservation_count: number;
    days_until_departure: number;
  }[];
  recent_activity: {
    type: "trip_created" | "reservation_created" | "boarding";
    label: string;
    timestamp: string;
  }[];
  reservations_by_date: { date: string; count: number }[];
  occupancy_by_trip: {
    trip_id: string;
    label: string;
    departure: string;
    total: number;
    reserved: number;
    occupancy_pct: number;
  }[];
}

const QUICK_ACTIONS = [
  {
    href: "/admin/trips",
    title: "Gestión de viajes",
    desc: "Crear, editar y eliminar viajes",
    icon: Calendar,
  },
  {
    href: "/admin/routes",
    title: "Gestión de rutas",
    desc: "Administrar rutas disponibles",
    icon: Route,
  },
  {
    href: "/admin/agencies",
    title: "Agencias",
    desc: "Gestionar agencias y subdominios",
    icon: Building2,
  },
];

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const dashboard = await adminApi.getDashboard();
      setData(dashboard);
      setInitialized(true);
    } catch (err) {
      console.error("[AdminDashboard] Error fetching dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Realtime: al cambiar asientos, refrescar dashboard completo desde backend
  useEffect(() => {
    if (!initialized || !data) return;

    const tripIds = (data.upcoming_trips || []).map((t) => t.id);

    const cleanupSeats = tripIds.length
      ? subscribeToTripSeats(tripIds, () => {
          fetchDashboard();
        })
      : () => {};

    return () => {
      cleanupSeats();
    };
  }, [initialized]);

  return (
    <>
      <Topbar
        greeting={`${getGreeting()}, Administrador`}
        subtext="Panel de Administración — NomadApp"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <SectionTitle>Acciones rápidas</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-10">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                className="no-underline group"
              >
                <Card hover borderLeft borderColor="var(--color-brand-cyan)">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-[var(--color-brand-navy)]">
                      <Icon className="w-6 h-6 text-[var(--color-brand-cyan)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-[family-name:var(--font-body)] font-semibold text-[17px] text-[var(--color-brand-navy)]">
                        {action.title}
                      </h2>
                      <p className="font-[family-name:var(--font-body)] font-normal text-[13px] text-[var(--color-brand-muted)]">
                        {action.desc}
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-[var(--color-brand-muted)] group-hover:text-[var(--color-brand-cyan)] transition-colors shrink-0" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>

        <SectionTitle>Resumen del sistema</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          <StatCard
            icon={<Calendar className="w-5 h-5" />}
            label="Viajes activos"
            value={loading ? "—" : data?.active_trips ?? 0}
            loading={loading}
          />
          <StatCard
            icon={<Building2 className="w-5 h-5" />}
            label="Agencias activas"
            value={loading ? "—" : data?.active_agencies ?? 0}
            loading={loading}
            iconBg="bg-[rgba(245,158,11,0.1)]"
            iconColor="text-[#f59e0b]"
          />
          <StatCard
            icon={<Ticket className="w-5 h-5" />}
            label="Reservas hoy"
            value={loading ? "—" : data?.today_reservations ?? 0}
            loading={loading}
            iconBg="bg-[rgba(16,185,129,0.1)]"
            iconColor="text-[#10b981]"
          />
          <StatCard
            icon={<UserCheck className="w-5 h-5" />}
            label="Pendientes boarding"
            value={loading ? "—" : data?.pending_boarding_passengers ?? 0}
            loading={loading}
            iconBg="bg-[rgba(239,68,68,0.1)]"
            iconColor="text-[#ef4444]"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
          <Timeline items={data?.upcoming_trips ?? []} loading={loading} />
          <ActivityWidget
            activities={data?.recent_activity ?? []}
            loading={loading}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
          <ReservationChart
            data={data?.reservations_by_date ?? []}
            loading={loading}
          />
          <OccupancyChart
            data={data?.occupancy_by_trip ?? []}
            loading={loading}
          />
        </div>
      </main>
    </>
  );
}
