'use client';

import { motion } from 'framer-motion';
import { Seat as SeatType } from '@/types';

interface SeatProps {
  seat: SeatType | null;
  isSelected: boolean;
  onSelect: (seat: SeatType) => void;
}

export function Seat({ seat, isSelected, onSelect }: SeatProps) {
  if (!seat) {
    return <div className="w-10 h-10 sm:w-14 sm:h-14" />;
  }

  const isGuide = seat.seat_code === 'G';
  const isClickable = !isGuide && (seat.status === 'available' || isSelected);

  let bg = '';
  let textColor = '';
  let cursor = '';

  if (isGuide) {
    bg = '#071946';
    textColor = '#ffffff';
    cursor = 'default';
  } else if (isSelected) {
    bg = '#f59e0b';
    textColor = '#ffffff';
    cursor = 'pointer';
  } else if (seat.status === 'available') {
    bg = '#00D4FF';
    textColor = '#ffffff';
    cursor = 'pointer';
  } else if (seat.status === 'reserved') {
    bg = '#374151';
    textColor = '#6b7280';
    cursor = 'not-allowed';
  } else if (seat.status === 'blocked') {
    bg = '#7c3aed';
    textColor = '#ffffff';
    cursor = 'not-allowed';
  } else {
    bg = '#374151';
    textColor = '#6b7280';
    cursor = 'not-allowed';
  }

  const handleClick = () => {
    if (!isClickable) return;
    onSelect(seat);
  };

  const isLockedByOther = seat.status === 'locked' && !isSelected;

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      disabled={!isClickable}
      whileHover={isClickable && !isSelected ? { scale: 1.05, boxShadow: '0 4px 12px rgba(0,212,255,0.4)' } : undefined}
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
          ? { duration: 2, repeat: Infinity, ease: 'easeInOut' }
          : isSelected
            ? { duration: 0.2 }
            : { type: 'spring', stiffness: 500, damping: 20 }
      }
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: isGuide ? bg : bg,
        color: textColor,
        cursor,
        border: isGuide ? '2px solid #00D4FF' : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 700,
        boxShadow: isSelected ? '0 4px 12px rgba(245,158,11,0.4)' : isLockedByOther ? '0 0 0 2px rgba(239,68,68,0.5)' : 'none',
        opacity: seat.status === 'blocked' ? 0.7 : 1,
      }}
      className="sm:w-14 sm:h-14 sm:text-sm"
      title={`Asiento ${seat.seat_code}`}
    >
      <span style={{ lineHeight: 1 }}>{seat.seat_code}</span>
    </motion.button>
  );
}
