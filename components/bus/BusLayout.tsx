'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Seat as SeatType } from '@/types';
import { generateBusLayout } from '@/constants/bus';
import { Seat } from './Seat';

interface BusLayoutProps {
  seats: Record<string, SeatType>;
  selectedSeats: SeatType[];
  onToggleSeat: (seat: SeatType) => void;
  totalSeats?: number;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const rowVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 200, damping: 20 },
  },
};

export function BusLayout({
  seats,
  selectedSeats,
  onToggleSeat,
  totalSeats = 30,
}: BusLayoutProps) {
  const layout = useMemo(() => generateBusLayout(totalSeats), [totalSeats]);
  const guideSeat: SeatType | null = seats['G'] ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      style={{
        background: '#ffffff',
        borderRadius: 16,
        padding: 16,
        boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
        display: 'inline-block',
        maxWidth: '100%',
      }}
    >
      <div className="flex flex-col items-center gap-4 min-w-[280px]">
        {/* FRENTE label */}
        <div className="flex items-center gap-2" style={{ opacity: 0.4 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--color-brand-muted)' }}>
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 11, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Frente
          </span>
        </div>

        {/* Guide seat */}
        {guideSeat && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
            className="flex justify-start w-full"
          >
            <div className="flex items-center gap-2">
              <Seat
                seat={guideSeat}
                isSelected={false}
                onSelect={() => {}}
              />
              <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 10, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Guía
              </span>
            </div>
          </motion.div>
        )}

        {/* Bus body */}
        <div
          style={{
            background: 'var(--color-brand-dark)',
            borderRadius: 20,
            padding: '16px 12px',
            width: '100%',
          }}
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-1.5 sm:space-y-2"
          >
              {layout.rows.map((row, rowIndex) => (
              <motion.div
                key={rowIndex}
                variants={rowVariants}
                className="flex items-center justify-center"
              >
                <div className="flex gap-0.5 sm:gap-1">
                  {row.left.map((seatCode, idx) => {
                    if (!seatCode) return <div key={`empty-${idx}`} className="w-10 h-10 sm:w-14 sm:h-14" />;
                    const seat = seats[seatCode] ?? {
                      id: '',
                      trip_id: '',
                      seat_code: seatCode,
                      status: 'available' as const,
                      locked_by: null,
                      locked_at: null,
                      updated_at: '',
                    };
                    return (
                      <Seat
                        key={seatCode}
                        seat={seat}
                        isSelected={selectedSeats.some((s) => s.seat_code === seatCode)}
                        onSelect={onToggleSeat}
                      />
                    );
                  })}
                </div>

                <div style={{ width: 32, flexShrink: 0 }} />

                <div className="flex gap-0.5 sm:gap-1">
                  {row.right.map((seatCode, idx) => {
                    if (!seatCode) return <div key={`empty-${idx}`} className="w-10 h-10 sm:w-14 sm:h-14" />;
                    const seat = seats[seatCode] ?? {
                      id: '',
                      trip_id: '',
                      seat_code: seatCode,
                      status: 'available' as const,
                      locked_by: null,
                      locked_at: null,
                      updated_at: '',
                    };
                    return (
                      <Seat
                        key={seatCode}
                        seat={seat}
                        isSelected={selectedSeats.some((s) => s.seat_code === seatCode)}
                        onSelect={onToggleSeat}
                      />
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* FONDO label */}
        <div className="flex items-center gap-2" style={{ opacity: 0.4 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--color-brand-muted)' }}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" />
          </svg>
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 11, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Fondo
          </span>
        </div>
      </div>
    </motion.div>
  );
}
