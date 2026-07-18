"use client";

import { useMemo, useRef, useLayoutEffect, useState } from "react";
import { motion } from "framer-motion";
import { Seat as SeatType } from "@/types";
import { busRows, kiaRows } from "@/components/booking/layouts";
import { Seat, SEAT_SIZE } from "./Seat";

interface SeatInfo {
  passengerName?: string;
  agencyName?: string;
}

interface BusLayoutProps {
  seats: Record<string, SeatType>;
  selectedSeats: SeatType[];
  onToggleSeat?: (seat: SeatType) => void;
  vehicleType: "bus" | "kia";
  userId?: string | null;
  seatInfo?: Record<string, SeatInfo>;
  mode?: "interactive" | "preview";
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
      <line x1="8" y1="0.5" x2="8" y2="5.5" stroke="#9ca3af" strokeWidth="1.5" />
      <line x1="8" y1="10.5" x2="8" y2="15.5" stroke="#9ca3af" strokeWidth="1.5" />
      <line x1="0.5" y1="8" x2="5.5" y2="8" stroke="#9ca3af" strokeWidth="1.5" />
      <line x1="10.5" y1="8" x2="15.5" y2="8" stroke="#9ca3af" strokeWidth="1.5" />
    </svg>
  );
}

function SteeringWheelIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
      <circle cx="18" cy="18" r="16" stroke="#9ca3af" strokeWidth="2.5" />
      <circle cx="18" cy="18" r="5" stroke="#9ca3af" strokeWidth="2" fill="none" />
      <line x1="18" y1="13" x2="18" y2="2" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="18" y1="13" x2="5.5" y2="25" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="18" y1="13" x2="30.5" y2="25" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function BusLayout({
  seats,
  selectedSeats,
  onToggleSeat,
  vehicleType,
  userId,
  seatInfo,
  mode = "interactive",
}: BusLayoutProps) {
  const rows = useMemo(() => {
    if (vehicleType === "kia") return kiaRows;
    return busRows;
  }, [vehicleType]);

  const reversedRows = useMemo(() => [...rows].reverse(), [rows]);

  const containerRef = useRef<HTMLDivElement>(null);
  const busContentRef = useRef<HTMLDivElement>(null);
  const carroceriaRef = useRef<HTMLDivElement>(null);
  const doorRowRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState(1);
  const [doorTop, setDoorTop] = useState(0);

  const BUS_NATURAL_WIDTH = 310;
  const KIA_NATURAL_WIDTH = 256;

  const naturalWidth = vehicleType === "kia" ? KIA_NATURAL_WIDTH : BUS_NATURAL_WIDTH;
  const isPreview = mode === "preview";

  useLayoutEffect(() => {
    function measure() {
      if (containerRef.current && busContentRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const s = Math.min(1, containerWidth / BUS_NATURAL_WIDTH);
        setScale(s);
      }
      if (!carroceriaRef.current) return;
      const carRect = carroceriaRef.current.getBoundingClientRect();

      if (doorRowRef.current) {
        const doorRect = doorRowRef.current.getBoundingClientRect();
        const doorRowOffsetTop = doorRect.top - carRect.top;
        const doorRowCenter = doorRowOffsetTop + doorRect.height / 2;
        setDoorTop(doorRowCenter - DOOR_HEIGHT / 2);
      }
    }
    measure();
    if (!isPreview) {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
  }, [vehicleType, isPreview]);

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
        onSelect={isPreview ? undefined : onToggleSeat}
        userId={userId}
        seatInfo={seatInfo?.[code]}
        mode={mode}
      />
    );
  };

  const rowVariants = isPreview
    ? undefined
    : {
        hidden: { opacity: 0, y: 16 },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            type: "spring" as const,
            stiffness: 200,
            damping: 20,
          },
        },
      };

  const containerVariants = isPreview
    ? undefined
    : { visible: { transition: { staggerChildren: 0.03 } } };

  return (
    <div ref={containerRef} className="flex flex-col items-center w-full">
      <div
        ref={busContentRef}
        style={{
          transform: isPreview ? undefined : `scale(${scale})`,
          transformOrigin: "top center",
          width: naturalWidth,
          maxWidth: naturalWidth,
          flexShrink: 0,
        }}
      >
        <div className="flex items-center justify-center gap-2 mb-3">
          <CrosshairIcon />
          <span className="font-['Poppins',sans-serif] font-semibold text-[12px] uppercase tracking-[0.1em] text-brand-muted">
            FONDO
          </span>
        </div>

        <div
          ref={carroceriaRef}
          className="relative overflow-visible"
          style={{
            background: "#d1d5db",
            borderRadius: "40px 40px 24px 24px",
            border: "3px solid #9ca3af",
            boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
            padding: "0 10px 10px 10px",
          }}
        >
          <div
            className="-mx-[10px] mt-[10px]"
            style={{
              background: "#6b7280",
              height: 24,
              borderRadius: "30px 30px 0 0",
            }}
          />

          <div
            className="absolute z-20 flex items-center justify-center"
            style={{
              left: -4,
              top: doorTop,
              width: 14,
              height: DOOR_HEIGHT,
              background: "#9ca3af",
              borderRadius: 4,
            }}
          >
            <div className="absolute right-full mr-3 flex items-center justify-center h-full">
              <span
                className="font-['Poppins',sans-serif] font-semibold text-[10px] text-brand-muted whitespace-nowrap"
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

          <div className="absolute top-[34px] left-[6px] z-0 flex flex-col justify-around" style={{ height: vehicleType === "kia" ? 220 : 280 }}>
            <div className="w-[5px] h-[36px] rounded-sm" style={{ background: "#9ca3af" }} />
            <div className="w-[5px] h-[36px] rounded-sm" style={{ background: "#9ca3af" }} />
            <div className="w-[5px] h-[36px] rounded-sm" style={{ background: "#9ca3af" }} />
          </div>
          <div className="absolute top-[34px] right-[6px] z-0 flex flex-col justify-around" style={{ height: vehicleType === "kia" ? 220 : 280 }}>
            <div className="w-[5px] h-[36px] rounded-sm" style={{ background: "#9ca3af" }} />
            <div className="w-[5px] h-[36px] rounded-sm" style={{ background: "#9ca3af" }} />
            <div className="w-[5px] h-[36px] rounded-sm" style={{ background: "#9ca3af" }} />
          </div>

          <div
            className="relative z-10"
            style={{ background: "#00000C", padding: vehicleType === "kia" ? "14px 4px" : "14px 6px" }}
          >
            <motion.div
              initial={isPreview ? "visible" : "hidden"}
              animate="visible"
              variants={containerVariants}
              className="flex flex-col"
              style={{ gap: 8 }}
            >
              {reversedRows.map((row, rowIndex) => {
                const isTopRow = row.right.length === 0;
                const isDoorRow = row.isDoor ?? (!isTopRow && row.left[0] === null && row.left[1] === null);

                return (
                  <motion.div
                    key={rowIndex}
                    ref={isDoorRow ? doorRowRef : undefined}
                    initial={isPreview ? undefined : "hidden"}
                    animate="visible"
                    variants={isPreview ? undefined : rowVariants}
                    className="flex items-center justify-center w-full"
                    style={{ gap: SEAT_GAP }}
                  >
                    {vehicleType === "kia" ? (
                      <div className="flex items-center" style={{ gap: SEAT_GAP }}>
                        {isTopRow && row.left.length > 0 ? (
                          row.left.map((code, i) => (
                            <span key={i} className="flex shrink-0">
                              {renderSeat(code)}
                            </span>
                          ))
                        ) : (
                          <>
                            <div className="shrink-0" style={{ width: SEAT_SIZE, height: SEAT_SIZE }} />
                            <div className="shrink-0" style={{ width: SEAT_SIZE, height: SEAT_SIZE }} />
                            {row.right.map((code, i) => (
                              <span key={i} className="flex shrink-0">
                                {renderSeat(code)}
                              </span>
                            ))}
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center" style={{ gap: SEAT_GAP }}>
                        {isTopRow && row.left.length >= 5 ? (
                          row.left.map((code, i) => (
                            <span key={i} className="flex shrink-0">
                              {renderSeat(code)}
                            </span>
                          ))
                        ) : isDoorRow ? (
                          <>
                            <div
                              className="shrink-0 rounded-lg"
                              style={{
                                width: SEAT_SIZE * 2 + SEAT_GAP,
                                height: SEAT_SIZE,
                                border: "2px dashed #374151",
                              }}
                            />
                            <div className="shrink-0" style={{ width: SEAT_SIZE, height: SEAT_SIZE }} />
                            {row.right.map((code, i) => (
                              <span key={i} className="flex shrink-0">
                                {renderSeat(code)}
                              </span>
                            ))}
                          </>
                        ) : (
                          <>
                            {row.left.map((code, i) => (
                              <span key={i} className="flex shrink-0">
                                {renderSeat(code)}
                              </span>
                            ))}
                            <div className="shrink-0" style={{ width: SEAT_SIZE, height: SEAT_SIZE }} />
                            {row.right.map((code, i) => (
                              <span key={i} className="flex shrink-0">
                                {renderSeat(code)}
                              </span>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          </div>

          <div className="h-px relative z-10" style={{ background: "#374151" }} />

          <div
            className="flex items-center justify-between px-4 relative z-10"
            style={{ background: "#1f2937", height: 100, borderRadius: "0 0 16px 16px" }}
          >
            <div
              className="flex items-center justify-center shrink-0 rounded-xl"
              style={{
                width: 56,
                height: 56,
                background: "#000024",
                border: "2px solid #00D4FF",
              }}
            >
              <span className="font-['Poppins',sans-serif] font-bold text-[11px] text-[#00D4FF]">
                Guía
              </span>
            </div>

            <div className="relative shrink-0" style={{ width: 56, height: 56 }}>
              <div
                className="absolute bottom-0 w-full h-full rounded-xl"
                style={{ background: "#ea580c" }}
              />
              <span className="absolute inset-0 flex items-center justify-center font-['Poppins',sans-serif] font-bold text-lg text-white z-10">
                C
              </span>
              <div
                className="absolute -bottom-[20px] left-1/2 -translate-x-1/2 z-20"
                style={{ transform: "rotate(180deg)" }}
              >
                <SteeringWheelIcon />
              </div>
            </div>
          </div>
          <div className="absolute z-0" style={{ left: 22, bottom: vehicleType === "kia" ? -8 : -8, width: 36, height: 20, background: "#1f2937", borderRadius: 6 }} />
          <div className="absolute z-0" style={{ right: 22, bottom: vehicleType === "kia" ? -8 : -8, width: 36, height: 20, background: "#1f2937", borderRadius: 6 }} />
          <div className="absolute z-0" style={{ left: 22, bottom: vehicleType === "kia" ? 130 : 170, width: 36, height: 20, background: "#1f2937", borderRadius: 6 }} />
          <div className="absolute z-0" style={{ right: 22, bottom: vehicleType === "kia" ? 130 : 170, width: 36, height: 20, background: "#1f2937", borderRadius: 6 }} />
        </div>

        <div className="flex items-center justify-center gap-2 mt-3">
          <CrosshairIcon />
          <span className="font-['Poppins',sans-serif] font-semibold text-[12px] uppercase tracking-[0.1em] text-brand-muted">
            FRENTE
          </span>
        </div>
      </div>
    </div>
  );
}
