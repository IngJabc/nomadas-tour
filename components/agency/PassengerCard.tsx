"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import type { AgencyTripPassenger } from "@/types";

const ease = [0.4, 0, 0.2, 1] as const;

export const passengerCardVariants = {
  hidden: { opacity: 0, scale: 0.96, y: 6 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.2, ease },
  },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.12 } },
};

const STATUS_MAP: Record<string, { variant: "confirmed" | "cancelled" | "active" | "boarded" | "inactive"; label: string }> = {
  confirmed: { variant: "confirmed", label: "Confirmada" },
  cancelled: { variant: "cancelled", label: "Cancelada" },
  partial: { variant: "active", label: "Parcial" },
  completed: { variant: "inactive", label: "Completada" },
};

interface PassengerCardProps {
  passenger: AgencyTripPassenger;
}

export function PassengerCard({ passenger }: PassengerCardProps) {
  const status = passenger.boarded
    ? { variant: "boarded" as const, label: "Abordado" }
    : STATUS_MAP[passenger.reservation_status] ?? { variant: "confirmed" as const, label: "Confirmada" };

  return (
    <motion.div
      variants={passengerCardVariants}
      className="flex items-center gap-3 p-3 bg-white rounded-xl border border-[rgba(0,0,0,0.06)] transition-all duration-150 hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:-translate-y-0.5"
    >
      <div className="w-9 h-9 rounded-lg bg-[rgba(0,212,255,0.1)] flex items-center justify-center shrink-0">
        <span className="font-[family-name:var(--font-heading)] font-bold text-sm text-[var(--color-brand-cyan)]">
          {passenger.seat_code}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-[family-name:var(--font-body)] font-semibold text-[13px] text-[var(--color-brand-navy)] truncate">
          {passenger.name}
        </p>
        <p className="font-[family-name:var(--font-body)] text-[10px] text-[var(--color-brand-muted)]">
          {passenger.document}
        </p>
        <p className="font-[family-name:var(--font-body)] text-[10px] text-[var(--color-brand-muted)]">
          Reserva #{passenger.reservation_id.slice(0, 8)}
        </p>
      </div>

      <div className="shrink-0">
        <Badge variant={status.variant} size="xs">
          {status.label}
        </Badge>
      </div>
    </motion.div>
  );
}
