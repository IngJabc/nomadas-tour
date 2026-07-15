"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ClipboardList,
  QrCode,
  ArrowRight,
  Calendar,
  Users,
  UserCheck,
  Ticket,
  Bus,
  AlertTriangle,
} from "lucide-react";
import { agencyApi } from "@/lib/api";
import {
  subscribeToTripSeats,
  subscribeToReservations,
  subscribeToTrips,
  subscribeToBoardingLogs,
  subscribeToTripAgencies,
} from "@/lib/realtime/subscriptions";
import { getGreeting } from "@/lib/utils/greeting";
import { Topbar } from "@/components/layout/Topbar";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ActivityWidget } from "@/components/dashboard/ActivityWidget";
import { Timeline } from "@/components/dashboard/Timeline";
import { OccupancyChart } from "@/components/dashboard/charts/OccupancyChart";
import { createClient } from "@/lib/supabase/client";
import { pageFade, staggerContainer, staggerItem } from "@/lib/motion/variants";

interface AgencyDashboardData {
  agency_name?: string;
  total_trips: number;
  active_trips: number;
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
    type: "reservation_created" | "boarding" | "trip_assigned";
    label: string;
    timestamp: string;
  }[];
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
    href: "/agency/reservations/new",
    title: "Nueva reserva",
    desc: "Crea una reserva para un viaje asignado",
    icon: Ticket,
  },
  {
    href: "/agency/reservations",
    title: "Ver reservas",
    desc: "Consulta y gestiona las reservas de tu agencia",
    icon: ClipboardList,
  },
  {
    href: "/agency/scan",
    title: "Escanear QR",
    desc: "Aborda pasajeros con el escáner QR",
    icon: QrCode,
  },
  {
    href: "/agency/trips",
    title: "Mis viajes",
    desc: "Visualiza los viajes asignados a tu agencia",
    icon: Bus,
  },
];

export default function AgencyDashboardPage() {
  const [data, setData] = useState<AgencyDashboardData | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [agencyId, setAgencyId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      const id = (user?.user_metadata?.agency_id as string) ?? null;
      setAgencyId(id);
    });
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      setFetchError(null);
      const dashboard = await agencyApi.getDashboard();
      setData(dashboard);
      setInitialized(true);
    } catch {
      setFetchError("No se pudo cargar el dashboard. Intenta de nuevo.");
    } finally {
      setInitialLoad(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const fetchDashboardRef = useRef(fetchDashboard);
  fetchDashboardRef.current = fetchDashboard;

  const tripIdsKey = useMemo(
    () =>
      (data?.upcoming_trips || [])
        .map((t) => t.id)
        .sort()
        .join(","),
    [data?.upcoming_trips]
  );

  useEffect(() => {
    if (!initialized) return;
    const tripIds = tripIdsKey ? tripIdsKey.split(",") : [];
    const cleanupSeats = tripIds.length
      ? subscribeToTripSeats(tripIds, () => {
          fetchDashboardRef.current();
        })
      : () => {};
    return () => {
      cleanupSeats();
    };
  }, [initialized, tripIdsKey]);

  // Realtime: cambios en reservas, viajes, boarding y asignaciones — filtrado por agencyId, con debounce
  useEffect(() => {
    if (!initialized) return;

    const debounceTimerRef: { current: ReturnType<typeof setTimeout> | null } =
      { current: null };

    const handleEvent = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        fetchDashboardRef.current();
      }, 500);
    };

    const cleanupReservations = subscribeToReservations(
      handleEvent,
      agencyId ?? undefined
    );
    const cleanupTrips = subscribeToTrips(handleEvent);
    const cleanupBoarding = subscribeToBoardingLogs(
      handleEvent,
      undefined,
      agencyId ?? undefined
    );
    const cleanupTripAgencies = subscribeToTripAgencies(
      handleEvent,
      agencyId ?? undefined
    );

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      cleanupReservations();
      cleanupTrips();
      cleanupBoarding();
      cleanupTripAgencies();
    };
  }, [initialized, agencyId]);

  const loading = initialLoad;

  // ─── Loading skeleton ─────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Topbar
          greeting={`${getGreeting()}, Agencia`}
          subtext="Panel de Agencia — NomadApp"
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-1 h-[18px] bg-slate-200 rounded-sm shrink-0" />
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-10">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <div className="flex items-center gap-4">
                  <Skeleton className="w-12 h-12 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="w-5 h-5 rounded" />
                </div>
              </Card>
            ))}
          </div>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-1 h-[18px] bg-slate-200 rounded-sm shrink-0" />
            <Skeleton className="h-5 w-48" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-8 w-16" />
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
            <Card className="p-5 h-[500px]">
              <div className="flex items-center gap-2 mb-4">
                <Skeleton className="w-4 h-4 rounded" />
                <Skeleton className="h-4 w-36" />
              </div>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex gap-4">
                    <Skeleton className="w-14 h-10 rounded-lg shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-5 h-[500px]">
              <div className="flex items-center gap-2 mb-4">
                <Skeleton className="w-4 h-4 rounded" />
                <Skeleton className="h-4 w-36" />
              </div>
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 h-[104px]">
                    <Skeleton className="w-8 h-8 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-2.5 w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <Skeleton className="h-4 w-48 mb-4" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </Card>
        </main>
      </>
    );
  }

  // ─── Error state ──────────────────────────────────────────────────────
  if (fetchError && !data) {
    return (
      <>
        <Topbar
          greeting={`${getGreeting()}, Agencia`}
          subtext="Panel de Agencia — NomadApp"
        />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#fef2f2] border border-[#fee2e2]"
          >
            <div className="flex items-center gap-3">
              <AlertTriangle
                className="w-5 h-5 text-[#ef4444] shrink-0"
                strokeWidth={1.75}
              />
              <p className="font-[family-name:var(--font-body)] text-sm text-[#ef4444]">
                {fetchError}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={fetchDashboard}>
              Reintentar
            </Button>
          </motion.div>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar
        greeting={`${getGreeting()}, ${data?.agency_name ?? "Agencia"}`}
        subtext="Panel de Agencia — NomadApp"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <motion.div
          variants={pageFade}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.25 }}
        >
          <SectionTitle>Acciones rápidas</SectionTitle>
        </motion.div>
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-10"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <motion.div key={action.href} variants={staggerItem}>
                <Link href={action.href} className="no-underline group">
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
              </motion.div>
            );
          })}
        </motion.div>

        <motion.div
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10"
          variants={pageFade}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.25, delay: 0.1 }}
        >
          <Timeline items={data?.upcoming_trips ?? []} loading={false} />
          <ActivityWidget
            activities={data?.recent_activity ?? []}
            loading={false}
          />
        </motion.div>

        <motion.div
          className="mb-10"
          variants={pageFade}
          initial="hidden"
          animate="visible"
          transition={{ duration: 0.25, delay: 0.15 }}
        >
          <OccupancyChart
            data={data?.occupancy_by_trip ?? []}
            loading={false}
          />
        </motion.div>
      </main>
    </>
  );
}
