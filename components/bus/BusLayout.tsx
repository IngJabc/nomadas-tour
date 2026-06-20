"use client";

import { useMemo, useRef, useLayoutEffect, useState } from "react";
import { motion } from "framer-motion";
import { Seat as SeatType } from "@/types";
import { generateBusLayout } from "@/constants/bus";
import { Seat, SEAT_SIZE } from "./Seat";

interface BusLayoutProps {
  seats: Record<string, SeatType>;
  selectedSeats: SeatType[];
  onToggleSeat: (seat: SeatType) => void;
  totalSeats?: number;
}

const SEAT_GAP = 6;
const AISLE_WIDTH = 32;
const DOOR_HEIGHT = 90;

function defaultSeat(code: string): SeatType {
  return {
    id: "",
    trip_id: "",
    seat_code: code,
    status: "available",
    locked_by: null,
    locked_at: null,
    updated_at: "",
  };
}

function CrosshairIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.5" stroke="#9ca3af" strokeWidth="1.5" />
      <line
        x1="8"
        y1="0.5"
        x2="8"
        y2="5.5"
        stroke="#9ca3af"
        strokeWidth="1.5"
      />
      <line
        x1="8"
        y1="10.5"
        x2="8"
        y2="15.5"
        stroke="#9ca3af"
        strokeWidth="1.5"
      />
      <line
        x1="0.5"
        y1="8"
        x2="5.5"
        y2="8"
        stroke="#9ca3af"
        strokeWidth="1.5"
      />
      <line
        x1="10.5"
        y1="8"
        x2="15.5"
        y2="8"
        stroke="#9ca3af"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function SteeringWheelIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
      <circle cx="18" cy="18" r="16" stroke="#9ca3af" strokeWidth="2.5" />
      <circle
        cx="18"
        cy="18"
        r="5"
        stroke="#9ca3af"
        strokeWidth="2"
        fill="none"
      />
      <line
        x1="18"
        y1="13"
        x2="18"
        y2="2"
        stroke="#9ca3af"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="18"
        y1="13"
        x2="5.5"
        y2="25"
        stroke="#9ca3af"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="18"
        y1="13"
        x2="30.5"
        y2="25"
        stroke="#9ca3af"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BusLayout({
  seats,
  selectedSeats,
  onToggleSeat,
  totalSeats = 31,
}: BusLayoutProps) {
  const layout = useMemo(() => generateBusLayout(totalSeats), [totalSeats]);
  const reversedRows = useMemo(() => [...layout.rows].reverse(), [layout.rows]);

  const carroceriaRef = useRef<HTMLDivElement>(null);
  const blackBodyRef = useRef<HTMLDivElement>(null);
  const doorRowRef = useRef<HTMLDivElement>(null);

  const [wheelTops, setWheelTops] = useState({ upper: 60, lower: 300 });
  const [doorTop, setDoorTop] = useState(0);

  useLayoutEffect(() => {
    function measure() {
      if (!carroceriaRef.current || !blackBodyRef.current) return;
      const carRect = carroceriaRef.current.getBoundingClientRect();
      const bbRect = blackBodyRef.current.getBoundingClientRect();
      const bbOffsetTop = bbRect.top - carRect.top;
      const bbHeight = bbRect.height;

      setWheelTops({
        upper: bbOffsetTop + bbHeight * 0.12,
        lower: bbOffsetTop + bbHeight * 0.68,
      });

      if (doorRowRef.current) {
        const doorRect = doorRowRef.current.getBoundingClientRect();
        const doorRowOffsetTop = doorRect.top - carRect.top;
        const doorRowCenter = doorRowOffsetTop + doorRect.height / 2;
        setDoorTop(doorRowCenter - DOOR_HEIGHT / 2);
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [totalSeats]);

  const renderSeat = (code: string | null) => {
    if (!code)
      return (
        <div
          className="shrink-0"
          style={{ width: SEAT_SIZE, height: SEAT_SIZE }}
        />
      );
    const seat = seats[code] ?? defaultSeat(code);
    return (
      <Seat
        key={code}
        seat={seat}
        isSelected={selectedSeats.some((s) => s.seat_code === code)}
        onSelect={onToggleSeat}
      />
    );
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[360px] mx-auto">
      {/* FONDO */}
      <div className="flex items-center gap-2 mb-3">
        <CrosshairIcon />
        <span className="font-['Poppins',sans-serif] font-semibold text-[12px] uppercase tracking-[0.1em] text-[#6b7280]">
          FONDO
        </span>
      </div>

      <div
        ref={carroceriaRef}
        className="relative w-full overflow-visible"
        style={{
          background: "#c8ccd4",
          borderRadius: 36,
          border: "3px solid #9ca3af",
          boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
          padding: "0 10px 10px 10px",
        }}
      >
        <div
          className="-mx-[10px] mt-[10px]"
          style={{
            background: "#4b5563",
            height: 36,
            borderRadius: "30px 30px 0 0",
          }}
        />

        {/* Llantas - Ahora son más largas (height: 72) */}
        {(["upper", "lower"] as const).map((pos) => (
          <div key={pos}>
            <div
              className="absolute z-0"
              style={{
                left: -18,
                top: wheelTops[pos] - 12, // Restamos 12 para compensar el tamaño extra y mantener el centro
                width: 24,
                height: 72, // <-- Modificado
                borderRadius: 10,
                background: "#1f2937",
                border: "2px solid #111827",
              }}
            />
            <div
              className="absolute z-0"
              style={{
                right: -18,
                top: wheelTops[pos] - 12,
                width: 24,
                height: 72, // <-- Modificado
                borderRadius: 10,
                background: "#1f2937",
                border: "2px solid #111827",
              }}
            />
          </div>
        ))}

        {/* Puerta Principal con Texto Anidado para alineación perfecta */}
        <div
          className="absolute z-20 flex items-center justify-center"
          style={{
            left: -4,
            top: doorTop,
            width: 14,
            height: DOOR_HEIGHT,
            background: "#4b5563",
            borderRadius: 4,
          }}
        >
          {/* El contenedor con flex h-full mantiene el texto perfectamente centrado verticalmente con la puerta */}
          <div className="absolute right-full mr-3 flex items-center justify-center h-full">
            <span
              className="font-['Poppins',sans-serif] font-semibold text-[10px] text-[#6b7280] whitespace-nowrap"
              style={{
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
                letterSpacing: "0.06em",
              }}
            >
              PUERTA PRINCIPAL
            </span>
          </div>
        </div>

        <div
          ref={blackBodyRef}
          className="relative z-10"
          style={{ background: "#00000C", padding: "14px 12px" }}
        >
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
            className="flex flex-col"
            style={{ gap: 8 }}
          >
            {reversedRows.map((row, rowIndex) => {
              const isTopRow = row.right.length === 0;
              const isDoorRow =
                !isTopRow && row.left[0] === null && row.left[1] === null;

              return (
                <motion.div
                  key={rowIndex}
                  ref={isDoorRow ? doorRowRef : undefined}
                  variants={{
                    hidden: { opacity: 0, y: 16 },
                    visible: {
                      opacity: 1,
                      y: 0,
                      transition: {
                        type: "spring",
                        stiffness: 200,
                        damping: 20,
                      },
                    },
                  }}
                  className="flex items-center justify-center w-full"
                  style={{ gap: SEAT_GAP }}
                >
                  {isTopRow ? (
                    <div
                      className="flex w-full justify-center items-center"
                      style={{ gap: SEAT_GAP }}
                    >
                      {row.left.map((code, i) => (
                        <span key={i} className="flex shrink-0">
                          {renderSeat(code)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="flex" style={{ gap: SEAT_GAP }}>
                        {isDoorRow ? (
                          <div
                            className="shrink-0 rounded-lg"
                            style={{
                              width: SEAT_SIZE * 2 + SEAT_GAP,
                              height: SEAT_SIZE,
                              border: "2px dashed #374151",
                            }}
                          />
                        ) : (
                          row.left.map((code, i) => (
                            <span key={i}>{renderSeat(code)}</span>
                          ))
                        )}
                      </div>
                      <div style={{ width: AISLE_WIDTH, flexShrink: 0 }} />
                      <div className="flex" style={{ gap: SEAT_GAP }}>
                        {row.right.map((code, i) => (
                          <span key={i}>{renderSeat(code)}</span>
                        ))}
                      </div>
                    </>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        </div>

        <div className="h-px relative z-10" style={{ background: "#374151" }} />

        <div
          className="flex items-center justify-between px-4 relative z-10"
          style={{ background: "#1f2937", height: 100 }}
        >
          <div
            className="flex items-center justify-center shrink-0 rounded-xl"
            style={{
              width: 56,
              height: 56,
              background: "#1e3a5f",
              border: "2px solid #00D4FF",
            }}
          >
            <span className="font-['Poppins',sans-serif] font-bold text-lg text-white">
              G
            </span>
          </div>

          <div className="relative shrink-0" style={{ width: 56, height: 56 }}>
            <div
              className="absolute bottom-0 w-full h-full rounded-xl"
              style={{ background: "#ea580c" }}
            />
            <div
              className="absolute -bottom-[20px] left-1/2 -translate-x-1/2 z-20"
              style={{ transform: "rotate(180deg)" }}
            >
              <SteeringWheelIcon />
            </div>
          </div>
        </div>

        <div
          className="mx-5 mb-2 relative z-10"
          style={{
            background: "#374151",
            height: 22,
            borderRadius: "0 0 8px 8px",
          }}
        />
      </div>

      <div className="flex justify-between w-[260px]">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col items-center">
            <div
              className="w-[10px] h-[28px]"
              style={{ background: "#1f2937", borderRadius: "0 0 3px 3px" }}
            />
            <div
              className="w-[22px] h-[4px]"
              style={{ background: "#1f2937", borderRadius: 2 }}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <CrosshairIcon />
        <span className="font-['Poppins',sans-serif] font-semibold text-[12px] uppercase tracking-[0.1em] text-[#6b7280]">
          FRENTE
        </span>
      </div>
    </div>
  );
}
