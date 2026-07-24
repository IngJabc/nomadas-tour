"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Bus,
  Calendar,
  Clock,
  Users,
  AlertTriangle,
  Search,
  UserCheck,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { agencyApi } from "@/lib/api";
import { subscribeToTrips } from "@/lib/realtime/subscriptions";
import type {
  AgencyTripPassengersResponse,
  AgencyTripPassenger,
} from "@/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PassengerCard } from "@/components/agency/PassengerCard";
import { pageFade } from "@/lib/motion/variants";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const VEHICLE_LABELS: Record<string, string> = {
  bus: "Autobús",
  kia: "KIA",
  van: "Van",
  microbús: "Microbús",
};

const passengerGrid = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03 } },
};

export default function TripPassengersPage() {
  const router = useRouter();

  const params = useParams();
  const tripId = params.id as string;

  const [data, setData] = useState<AgencyTripPassengersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const doFetchRef = useRef<() => Promise<void>>(async () => {});

  const doFetch = useCallback(async () => {
    try {
      setFetchError(null);
      setLoading(true);
      const result = await agencyApi.getTripPassengers(tripId);
      setData(result);
    } catch {
      setFetchError("No se pudieron cargar los pasajeros. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    doFetchRef.current = doFetch;
  }, [doFetch]);

  useEffect(() => {
    doFetchRef.current();
  }, [doFetch]);

  // Realtime: refetch when trip status changes
  useEffect(() => {
    if (!data?.trip?.id) return;
    const tripIdForSub = data.trip.id;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = subscribeToTrips(
      (payload) => {
        if (payload.trip.id !== tripIdForSub) return;
        if (payload.eventType !== "UPDATE") return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          doFetchRef.current();
        }, 500);
      },
      [tripIdForSub]
    );

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      cleanup();
    };
  }, [data?.trip?.id]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase().trim();
    if (!q) return data.passengers;
    return data.passengers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.document.toLowerCase().includes(q) ||
        p.seat_code.toLowerCase().includes(q) ||
        p.booker_name.toLowerCase().includes(q)
    );
  }, [data, search]);

  const trip = data?.trip;
  const isClosed = trip?.status === "cancelled" || trip?.status === "completed";

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 space-y-3">
          <div className="h-3 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-8 w-64 bg-slate-200 rounded animate-pulse" />
        </div>
        <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] animate-pulse mb-6">
          <div className="h-6 bg-slate-200 rounded w-48 mb-4" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-2.5 bg-slate-200 rounded w-16" />
                <div className="h-5 bg-slate-200 rounded w-24" />
              </div>
            ))}
          </div>
        </div>
        <div className="h-10 bg-slate-200 rounded-xl animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 bg-white rounded-xl border border-[rgba(0,0,0,0.06)] animate-pulse"
            >
              <div className="w-9 h-9 bg-slate-200 rounded-lg shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-slate-200 rounded w-24" />
                <div className="h-2.5 bg-slate-200 rounded w-20" />
                <div className="h-2.5 bg-slate-200 rounded w-16" />
              </div>
              <div className="h-4 bg-slate-200 rounded-full w-16 shrink-0" />
            </div>
          ))}
        </div>
      </main>
    );
  }

  if (fetchError) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader
          title="Pasajeros del viaje"
          breadcrumbs={[{ label: "Viajes", href: "/agency/trips" }]}
        />
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
          <Button variant="secondary" size="sm" onClick={doFetch}>
            Reintentar
          </Button>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-4">
        <button
          type="button"
          onClick={() => router.push("/agency/trips")}
          className="flex items-center gap-1.5 font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-muted)] cursor-pointer bg-transparent border-none hover:text-[var(--color-brand-navy)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a Mis viajes
        </button>
      </div>
      <motion.div
        variants={pageFade}
        initial="hidden"
        animate="visible"
        transition={{ duration: 0.25 }}
      >
        <PageHeader
          title={`Pasajeros — ${trip?.route?.destination ?? "Viaje"}`}
          action={
            trip?.status === "cancelled" ? (
              <Badge variant="cancelled" size="md">
                Cancelado
              </Badge>
            ) : trip?.status === "completed" ? (
              <Badge variant="completed" size="md">
                Completado
              </Badge>
            ) : undefined
          }
        />
      </motion.div>

      {trip?.status === "cancelled" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mb-4 p-4 rounded-xl bg-[#fef2f2] border border-[#fecaca]"
        >
          <div className="flex items-start gap-3">
            <XCircle
              className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5"
              strokeWidth={1.75}
            />
            <div>
              <p className="font-[family-name:var(--font-heading)] font-bold text-sm text-[#ef4444]">
                Viaje cancelado
              </p>
              <p className="font-[family-name:var(--font-body)] text-[13px] text-[#b91c1c] mt-1">
                Este viaje fue cancelado. No se permiten operaciones.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {trip?.status === "completed" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mb-4 p-4 rounded-xl bg-[#ecfdf5] border border-[#a7f3d0]"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2
              className="w-5 h-5 text-[#059669] shrink-0 mt-0.5"
              strokeWidth={1.75}
            />
            <div>
              <p className="font-[family-name:var(--font-heading)] font-bold text-sm text-[#059669]">
                Viaje completado
              </p>
              <p className="font-[family-name:var(--font-body)] text-[13px] text-[#047857] mt-1">
                Este viaje ya fue completado. No se permiten operaciones.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {trip && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
        >
          <Card className="mb-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="font-[family-name:var(--font-heading)] font-bold text-lg text-[var(--color-brand-navy)] mb-3">
                  {trip.route?.destination ?? "Destino desconocido"}
                </h2>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--color-brand-muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                    {formatDate(trip.departure_time)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    {formatTime(trip.departure_time)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Bus className="w-3.5 h-3.5 shrink-0" />
                    {VEHICLE_LABELS[trip.vehicle_type] ??
                      trip.vehicle_type} · {trip.total_seats} puestos
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-6 shrink-0">
                <div className="text-center">
                  <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                    Disponibles
                  </p>
                  <p className="font-[family-name:var(--font-heading)] font-bold text-[22px] text-[var(--color-brand-cyan)]">
                    {trip.available_seats}
                  </p>
                </div>
                <div className="text-center">
                  <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                    Reservados
                  </p>
                  <p className="font-[family-name:var(--font-heading)] font-bold text-[22px] text-[var(--color-brand-navy)]">
                    {trip.reserved_seats}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-[rgba(0,0,0,0.06)] flex items-center gap-4 text-[12px] text-[var(--color-brand-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                {data?.stats.total ?? 0} pasajeros
              </span>
              <span className="inline-flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5" />
                {data?.stats.boarded ?? 0} abordados
              </span>
            </div>
          </Card>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.1 }}
        className="mb-6"
      >
        <Input
          label="Buscar pasajero"
          placeholder="Nombre, documento o asiento..."
          leftIcon={<Search className="w-4 h-4" />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </motion.div>

      {filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25 }}
        >
          <EmptyState
            icon={<Users className="w-8 h-8" />}
            message={
              search
                ? "No se encontraron pasajeros con ese criterio"
                : "Este viaje aún no tiene pasajeros"
            }
            action={
              !search && !isClosed
                ? {
                    label: "Crear reserva",
                    href: `/agency/reservations/new?trip=${tripId}&source=trips`,
                  }
                : undefined
            }
          />
        </motion.div>
      ) : (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2"
          variants={passengerGrid}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence>
            {filtered.map((passenger: AgencyTripPassenger) => (
              <PassengerCard key={passenger.id} passenger={passenger} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </main>
  );
}
