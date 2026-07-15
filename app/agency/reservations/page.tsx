"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Search, Users, UserCheck, UserX, Plus, Eye } from "lucide-react";
import { agencyApi } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";

const STATUS_STYLES: Record<
  string,
  { label: string; variant: "confirmed" | "boarded" | "cancelled" | "warning" }
> = {
  confirmed: { label: "Confirmada", variant: "confirmed" },
  boarded: { label: "Abordado", variant: "boarded" },
  cancelled: { label: "Cancelada", variant: "cancelled" },
};

type Reservation = {
  id: string;
  booker_name: string;
  booker_document: string;
  booker_phone?: string | null;
  status: string;
  qr_code: string;
  trip_id: string;
  created_at: string;
  trips: {
    id: string;
    departure_time: string;
    vehicle_type: string;
    routes: { origin: string; destination: string } | null;
  } | null;
  reservation_passengers?: {
    id: string;
    name: string;
    document: string;
    phone?: string | null;
    status: string;
    seat_id: string;
    seats?: { seat_code: string };
  }[];
};

export default function AgencyReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await agencyApi.listReservations();
      setReservations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar reservas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getPassengersText = (r: Reservation) => {
    const count = r.reservation_passengers?.length ?? 1;
    const codes =
      r.reservation_passengers
        ?.map((p) => p.seats?.seat_code ?? "")
        .filter(Boolean)
        .join(", ") ?? "";
    return { count, codes };
  };

  const filtered = reservations.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const passengers = r.reservation_passengers ?? [];
      const matchPassenger = passengers.some(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.document.toLowerCase().includes(q)
      );
      return (
        r.booker_name.toLowerCase().includes(q) ||
        r.booker_document.toLowerCase().includes(q) ||
        r.qr_code?.toLowerCase().includes(q) ||
        r.id?.toLowerCase().includes(q) ||
        matchPassenger
      );
    }
    return true;
  });

  const confirmedCount = reservations.filter(
    (r) => r.status === "confirmed"
  ).length;
  const boardedCount = reservations.filter(
    (r) => r.status === "boarded"
  ).length;
  const cancelledCount = reservations.filter(
    (r) => r.status === "cancelled"
  ).length;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <PageHeader title="Reservas" />
        <Link
          href="/agency/reservations/new"
          className="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--color-brand-cyan)] text-white font-[family-name:var(--font-body)] font-semibold text-sm rounded-xl no-underline transition-all duration-200 hover:bg-[var(--color-brand-blue)]"
        >
          <Plus className="w-4 h-4" />
          Nueva reserva
        </Link>
      </div>

      <div className="sm:hidden mb-4">
        <Link
          href="/agency/reservations/new"
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-[var(--color-brand-cyan)] text-white font-[family-name:var(--font-body)] font-semibold text-sm rounded-xl no-underline transition-all duration-200 hover:bg-[var(--color-brand-blue)]"
        >
          <Plus className="w-4 h-4" />
          Nueva reserva
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex-1">
          <Input
            label="Buscar"
            leftIcon={<Search className="w-4 h-4" />}
            type="text"
            placeholder="Reservador, pasajero, documento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[
            ["", "Todas"],
            ["confirmed", "Confirmadas"],
            ["boarded", "Abordados"],
            ["cancelled", "Canceladas"],
          ].map(([s, label]) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-4 py-2.5 rounded-xl font-[family-name:var(--font-body)] font-semibold text-[13px] whitespace-nowrap cursor-pointer transition-all ${
                  active
                    ? "border-[1.5px] border-[var(--color-brand-cyan)] bg-[rgba(0,212,255,0.08)] text-[var(--color-brand-cyan)]"
                    : "border-[1.5px] border-[#e5e7eb] bg-white text-[var(--color-brand-muted)]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 font-[family-name:var(--font-body)] text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="w-8 h-8" />}
          message={
            search || statusFilter
              ? "No hay resultados con esos filtros"
              : "Aún no hay reservas"
          }
          action={
            search || statusFilter
              ? {
                  label: "Limpiar filtros",
                  onClick: () => {
                    setSearch("");
                    setStatusFilter("");
                  },
                }
              : {
                  label: "Crear primera reserva",
                  href: "/agency/reservations/new",
                }
          }
        />
      ) : (
        <>
          <div className="hidden sm:block bg-[var(--color-brand-surface)] rounded-2xl overflow-hidden border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-muted)] uppercase tracking-wider whitespace-nowrap">
                      Reservador
                    </th>
                    <th className="text-left px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-muted)] uppercase tracking-wider whitespace-nowrap">
                      Pasajeros
                    </th>
                    <th className="text-left px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-muted)] uppercase tracking-wider whitespace-nowrap">
                      Asientos
                    </th>
                    <th className="text-left px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-muted)] uppercase tracking-wider whitespace-nowrap">
                      Ruta
                    </th>
                    <th className="text-left px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-muted)] uppercase tracking-wider whitespace-nowrap">
                      Estado
                    </th>
                    <th className="text-left px-5 py-3 font-[family-name:var(--font-body)] font-semibold text-xs text-[var(--color-brand-muted)] uppercase tracking-wider whitespace-nowrap">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const bs =
                      STATUS_STYLES[r.status] ?? STATUS_STYLES.confirmed;
                    const { count, codes } = getPassengersText(r);
                    return (
                      <tr
                        key={r.id}
                        className="hover:bg-slate-50 transition-colors border-b border-slate-100"
                      >
                        <td className="px-5 py-4">
                          <p className="font-[family-name:var(--font-body)] font-medium text-sm text-[var(--color-brand-navy)]">
                            {r.booker_name}
                          </p>
                          <p className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">
                            {r.booker_document}
                          </p>
                        </td>
                        <td className="px-5 py-4 font-[family-name:var(--font-body)] font-normal text-sm text-[var(--color-brand-muted)]">
                          {count} {count === 1 ? "pasajero" : "pasajeros"}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <div className="flex flex-wrap gap-1">
                            {r.reservation_passengers?.map((p) => (
                              <span
                                key={p.id}
                                className="font-[family-name:var(--font-body)] font-bold text-[13px] text-[var(--color-brand-navy)] bg-slate-100 px-2.5 py-0.5 rounded-md"
                              >
                                {p.seats?.seat_code ?? "—"}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-4 font-[family-name:var(--font-body)] font-normal text-[13px] text-[var(--color-brand-muted)] whitespace-nowrap">
                          {r.trips?.routes?.origin ?? ""} →{" "}
                          {r.trips?.routes?.destination ?? ""}
                          <br />
                          <span className="text-[11px]">
                            {r.trips?.departure_time
                              ? format(
                                  new Date(r.trips.departure_time),
                                  "dd/MM HH:mm"
                                )
                              : ""}
                          </span>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <Badge variant={bs.variant} size="sm">
                            {bs.label}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <Link href={`/agency/reservations/${r.id}`}>
                            <Button variant="secondary" size="sm">
                              <Eye className="w-3.5 h-3.5 mr-1" />
                              Ver
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="sm:hidden space-y-3">
            {filtered.map((r) => {
              const bs = STATUS_STYLES[r.status] ?? STATUS_STYLES.confirmed;
              const { count, codes } = getPassengersText(r);
              return (
                <Link
                  key={r.id}
                  href={`/agency/reservations/${r.id}`}
                  className="block no-underline"
                >
                  <div className="bg-[var(--color-brand-surface)] rounded-2xl p-4 border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-[family-name:var(--font-body)] font-semibold text-sm text-[var(--color-brand-navy)]">
                          {r.booker_name}
                        </p>
                        <p className="font-[family-name:var(--font-body)] font-normal text-xs text-[var(--color-brand-muted)]">
                          {r.booker_document}
                        </p>
                      </div>
                      <Badge variant={bs.variant} size="sm">
                        {bs.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-[var(--color-brand-muted)] mb-3">
                      <span className="font-[family-name:var(--font-body)] text-[13px]">
                        {count} {count === 1 ? "pasajero" : "pasajeros"}
                      </span>
                      <span>
                        {r.trips?.routes?.origin ?? ""} →{" "}
                        {r.trips?.routes?.destination ?? ""}
                      </span>
                      <span>
                        {r.trips?.departure_time
                          ? format(
                              new Date(r.trips.departure_time),
                              "dd/MM HH:mm"
                            )
                          : ""}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {r.reservation_passengers?.map((p) => (
                        <span
                          key={p.id}
                          className="font-[family-name:var(--font-body)] font-bold text-[13px] text-[var(--color-brand-navy)] bg-slate-100 px-2 py-0.5 rounded-md"
                        >
                          {p.seats?.seat_code ?? "—"}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
