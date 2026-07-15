"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { Bus, Calendar, Clock, Users } from "lucide-react";
import { agencyApi } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CardSkeleton } from "@/components/ui/Skeleton";

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

export default function AgencyTripDetailPage() {
  const params = useParams();
  const tripId = params.id as string;
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await agencyApi.getTrip(tripId);
        setTrip(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Error al cargar el viaje"
        );
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [tripId]);

  const stats = useMemo(() => {
    if (!trip?.seats) return { total: 0, available: 0, reserved: 0 };
    const seats = trip.seats as any[];
    const total = seats.length;
    const available = seats.filter((s: any) => s.status === "available").length;
    const reserved = seats.filter(
      (s: any) => s.status === "reserved" || s.status === "boarded"
    ).length;
    return { total, available, reserved };
  }, [trip]);

  const route = trip?.routes;
  const isFull = stats.available === 0;

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <CardSkeleton />
      </main>
    );
  }

  if (error || !trip) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title="Viaje no encontrado" />
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 font-[family-name:var(--font-body)] text-sm text-red-600">
          {error || "El viaje no existe o no está disponible"}
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <PageHeader
        title={
          route ? `${route.origin} → ${route.destination}` : "Detalle del viaje"
        }
      />

      <Card>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="font-[family-name:var(--font-heading)] font-bold text-[20px] text-[var(--color-brand-navy)] mb-1">
              {route?.origin ?? "?"} → {route?.destination ?? "?"}
            </h2>
            {isFull && (
              <Badge variant="cancelled" size="sm">
                Completo
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5 text-[var(--color-brand-cyan)]" />
            </div>
            <div>
              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                Fecha
              </p>
              <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                {formatDate(trip.departure_time)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-[var(--color-brand-cyan)]" />
            </div>
            <div>
              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                Hora
              </p>
              <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                {formatTime(trip.departure_time)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
              <Bus className="w-5 h-5 text-[var(--color-brand-cyan)]" />
            </div>
            <div>
              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                Vehículo
              </p>
              <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                {trip.vehicle_type === "bus" ? "Autobús" : "Kia"} ·{" "}
                {stats.total} puestos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-[var(--color-brand-cyan)]" />
            </div>
            <div>
              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide">
                Capacidad
              </p>
              <p className="font-[family-name:var(--font-body)] font-semibold text-[14px] text-[var(--color-brand-navy)]">
                {stats.total} puestos
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-[rgba(0,0,0,0.06)] pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 rounded-xl bg-[rgba(0,212,255,0.08)]">
              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide mb-1">
                Disponibles
              </p>
              <p
                className={`font-[family-name:var(--font-heading)] font-bold text-[28px] ${
                  stats.available > 0
                    ? "text-[var(--color-brand-cyan)]"
                    : "text-[var(--color-brand-muted)]"
                }`}
              >
                {stats.available}
              </p>
            </div>
            <div className="text-center p-4 rounded-xl bg-slate-50">
              <p className="font-[family-name:var(--font-body)] font-normal text-[11px] text-[var(--color-brand-muted)] uppercase tracking-wide mb-1">
                Reservados
              </p>
              <p className="font-[family-name:var(--font-heading)] font-bold text-[28px] text-[var(--color-brand-navy)]">
                {stats.reserved}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </main>
  );
}
