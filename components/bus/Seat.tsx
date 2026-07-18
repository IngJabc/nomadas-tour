"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Seat as SeatType } from "@/types";

interface SeatInfo {
  passengerName?: string;
  agencyName?: string;
}

interface SeatProps {
  seat: SeatType | null;
  isSelected: boolean;
  onSelect?: (seat: SeatType) => void;
  userId?: string | null;
  seatInfo?: SeatInfo;
  mode?: "interactive" | "preview";
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
  { base: string; text: string; cursor: string; shadow?: string; opacity?: number }
> = {
  selected: {
    base: "#f59e0b", text: "#ffffff", cursor: "pointer",
    shadow: "0 4px 12px rgba(245,158,11,0.4)",
  },
  available: { base: "#00D4FF", text: "#ffffff", cursor: "pointer" },
  reserved: { base: "#374151", text: "#6b7280", cursor: "default" },
  blocked: { base: "#7c3aed", text: "#ffffff", cursor: "default", opacity: 0.7 },
  locked: { base: "#7c3aed", text: "#ffffff", cursor: "default", opacity: 0.7 },
  boarded: { base: "#10b981", text: "#ffffff", cursor: "default" },
};

const PREVIEW_OCCUPIED = { base: "#374151", text: "#6b7280" };

function getPreviewStyle(status: string): { base: string; text: string } {
  if (status === "available") return STATUS_STYLES.available;
  return PREVIEW_OCCUPIED;
}

export function Seat({ seat, isSelected, onSelect, userId, seatInfo, mode = "interactive" }: SeatProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!seat) {
    return (
      <div
        className="shrink-0"
        style={{ width: SEAT_SIZE, height: SEAT_SIZE }}
      />
    );
  }

  if (mode === "preview") {
    const { base, text } = getPreviewStyle(seat.status);
    return (
      <div
        className="shrink-0 flex items-center justify-center font-bold rounded-[10px]"
        style={{
          width: SEAT_SIZE,
          height: SEAT_SIZE,
          fontFamily: "'Poppins', sans-serif",
          fontSize: 11,
          background: twoTone(base),
          color: text,
          border: "none",
          boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
          padding: 0,
          lineHeight: 1,
        }}
      >
        {seat.seat_code}
      </div>
    );
  }

  const isLockedByMe = seat.status === "locked" && seat.locked_by === userId;
  const statusKey = isSelected || isLockedByMe
    ? "selected"
    : seat.status in STATUS_STYLES
    ? seat.status
    : "reserved";
  const {
    base, text, cursor, shadow = "0 2px 4px rgba(0,0,0,0.15)", opacity = 1,
  } = STATUS_STYLES[statusKey];
  const isClickable = (seat.status === "available" || isSelected || isLockedByMe) && !!onSelect;
  const isLockedByOther = seat.status === "locked" && !isSelected && !isLockedByMe;
  const hasTooltip = !!seatInfo?.passengerName;

  return (
    <div className="relative shrink-0">
      <motion.button
        type="button"
        onClick={() => isClickable && onSelect(seat)}
        disabled={!isClickable}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
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
      >
        {seat.seat_code}
      </motion.button>

      {hasTooltip && showTooltip && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none"
        >
          <div
            className="bg-[var(--color-brand-navy)] text-white rounded-lg px-3 py-2 text-xs shadow-lg whitespace-nowrap"
            style={{ fontFamily: "'Poppins', sans-serif" }}
          >
            <p className="font-semibold">Asiento {seat.seat_code}</p>
            {seatInfo?.passengerName && (
              <p className="text-white/80 mt-0.5">
                Pasajero: {seatInfo.passengerName}
              </p>
            )}
            {seatInfo?.agencyName && (
              <p className="text-white/60 mt-0.5">
                Agencia: {seatInfo.agencyName}
              </p>
            )}
          </div>
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "6px solid var(--color-brand-navy)",
            }}
          />
        </div>
      )}
    </div>
  );
}
