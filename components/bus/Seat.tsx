"use client";

import { motion } from "framer-motion";
import { Seat as SeatType } from "@/types";

interface SeatProps {
  seat: SeatType | null;
  isSelected: boolean;
  onSelect: (seat: SeatType) => void;
}

export const SEAT_SIZE = 48;

function darkenHex(hex: string, factor = 0.82): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function twoTone(base: string): string {
  const dark = darkenHex(base);
  return `linear-gradient(180deg, ${base} 0%, ${base} 52%, ${dark} 52%, ${dark} 100%)`;
}

const STATUS_STYLES: Record<
  string,
  {
    base: string;
    text: string;
    cursor: string;
    shadow?: string;
    opacity?: number;
  }
> = {
  selected: {
    base: "#f59e0b",
    text: "#ffffff",
    cursor: "pointer",
    shadow: "0 4px 12px rgba(245,158,11,0.4)",
  },
  available: { base: "#00D4FF", text: "#ffffff", cursor: "pointer" },
  reserved: { base: "#374151", text: "#6b7280", cursor: "not-allowed" },
  blocked: {
    base: "#7c3aed",
    text: "#ffffff",
    cursor: "not-allowed",
    opacity: 0.7,
  },
  locked: {
    base: "#374151",
    text: "#6b7280",
    cursor: "not-allowed",
    shadow: "0 0 0 2px rgba(239,68,68,0.5)",
  },
};

export function Seat({ seat, isSelected, onSelect }: SeatProps) {
  if (!seat) {
    return (
      <div
        className="shrink-0"
        style={{ width: SEAT_SIZE, height: SEAT_SIZE }}
      />
    );
  }

  const statusKey = isSelected
    ? "selected"
    : seat.status in STATUS_STYLES
    ? seat.status
    : "reserved";
  const {
    base,
    text,
    cursor,
    shadow = "0 2px 4px rgba(0,0,0,0.15)",
    opacity = 1,
  } = STATUS_STYLES[statusKey];
  const isClickable = seat.status === "available" || isSelected;
  const isLockedByOther = seat.status === "locked" && !isSelected;

  return (
    <motion.button
      type="button"
      onClick={() => isClickable && onSelect(seat)}
      disabled={!isClickable}
      whileHover={
        isClickable && !isSelected
          ? { scale: 1.05, boxShadow: "0 4px 12px rgba(0,212,255,0.4)" }
          : undefined
      }
      whileTap={isClickable ? { scale: 0.95 } : undefined}
      animate={
        isLockedByOther
          ? { scale: [1, 1.05, 1] }
          : isSelected
          ? { scale: [1, 1.1, 1] }
          : undefined
      }
      transition={
        isLockedByOther
          ? { duration: 2, repeat: Infinity, ease: "easeInOut" }
          : isSelected
          ? { duration: 0.2 }
          : { type: "spring", stiffness: 500, damping: 20 }
      }
      className="shrink-0 flex items-center justify-center font-bold rounded-[10px]"
      style={{
        width: SEAT_SIZE,
        height: SEAT_SIZE,
        fontFamily: "'Poppins', sans-serif",
        fontSize: 11,
        background: twoTone(base),
        color: text,
        cursor,
        border: "none",
        boxShadow: shadow,
        opacity,
        padding: 0,
        lineHeight: 1,
      }}
      title={`Asiento ${seat.seat_code}`}
    >
      {seat.seat_code}
    </motion.button>
  );
}
