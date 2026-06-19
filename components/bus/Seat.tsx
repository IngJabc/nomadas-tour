'use client';

import { Seat as SeatType } from '@/types';
import { cn } from '@/lib/utils';

interface SeatProps {
  seat: SeatType | null;
  isSelected: boolean;
  onSelect: (seat: SeatType) => void;
}

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-blue-500 hover:bg-blue-600 cursor-pointer',
  reserved: 'bg-red-500 cursor-not-allowed',
  locked: 'bg-amber-500 cursor-not-allowed',
  guide: 'bg-green-800 cursor-not-allowed',
  selected: 'bg-green-500 hover:bg-green-600 cursor-pointer',
};

export function Seat({ seat, isSelected, onSelect }: SeatProps) {
  if (!seat) {
    return <div className="w-14 h-14" />;
  }

  const isGuide = seat.seat_code === 'G';
  const statusClass = isGuide
    ? STATUS_COLORS.guide
    : isSelected
      ? STATUS_COLORS.selected
      : STATUS_COLORS[seat.status] ?? STATUS_COLORS.available;

  const handleClick = () => {
    if (isGuide) return;
    // Permitir click si está disponible, o si está locked por el usuario actual (para deseleccionar)
    if (seat.status !== 'available' && !isSelected) return;
    onSelect(seat);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isGuide || (seat.status !== 'available' && !isSelected)}
      className={cn(
        'w-14 h-14 rounded-lg flex items-center justify-center text-white font-bold text-sm transition-colors duration-150',
        statusClass,
      )}
      title={`Asiento ${seat.seat_code} - ${isGuide ? 'Guía' : seat.status}`}
    >
      {seat.seat_code}
    </button>
  );
}
