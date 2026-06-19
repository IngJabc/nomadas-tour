'use client';

import { useMemo } from 'react';
import { Seat as SeatType } from '@/types';
import { generateBusLayout } from '@/constants/bus';
import { Seat } from './Seat';

interface BusLayoutProps {
  seats: Record<string, SeatType>;
  selectedSeats: SeatType[];
  onToggleSeat: (seat: SeatType) => void;
  isSelected: (seatId: string) => boolean;
  totalSeats?: number;
}

export function BusLayout({
  seats,
  selectedSeats,
  onToggleSeat,
  isSelected,
  totalSeats = 30,
}: BusLayoutProps) {
  const layout = useMemo(() => generateBusLayout(totalSeats), [totalSeats]);
  const guideSeat: SeatType | null = seats['G'] ?? null;

  return (
    <div className="bg-gray-100 p-6 rounded-2xl inline-block">
      <div className="flex flex-col items-center gap-4">
        {guideSeat && (
          <div className="flex justify-start w-full mb-2">
            <Seat
              seat={guideSeat}
              isSelected={false}
              onSelect={() => {}}
            />
          </div>
        )}

        <div className="bg-white rounded-2xl p-6 shadow-md border-2 border-gray-300">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-8 bg-gray-300 rounded-t-full" />
          </div>

          <div className="space-y-2">
            {layout.rows.map((row, rowIndex) => (
              <div key={rowIndex} className="flex gap-8 items-center">
                {/* Left side */}
                <div className="flex gap-1">
                  {row.left.map((seatCode, idx) => {
                    if (!seatCode) return <div key={`empty-${idx}`} className="w-14 h-14" />;
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

                {/* Aisle - door icon for row with null */}
                <div className="w-6 flex justify-center">
                  {row.left[0] === null && (
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>

                {/* Right side */}
                <div className="flex gap-1">
                  {row.right.map((seatCode, idx) => {
                    if (!seatCode) return <div key={`empty-${idx}`} className="w-14 h-14" />;
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
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
