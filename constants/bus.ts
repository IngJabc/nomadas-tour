import { BusRow } from '@/types';

export const GUIDE_SEAT = 'G';

export function generateBusLayout(totalSeats: number): { rows: BusRow[]; frontLeft: string; totalSeats: number; guideSeats: string[] } {
  const totalRows = Math.max(1, Math.ceil(totalSeats / 4));

  const rows: BusRow[] = [];

  for (let r = 0; r < totalRows; r++) {
    const startIdx = r * 4 + 1;
    const rowCodes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const seatNum = startIdx + i;
      if (seatNum <= totalSeats) {
        rowCodes.push(`A${seatNum}`);
      } else {
        rowCodes.push('');
      }
    }

    const left = rowCodes.slice(0, 2).map((s) => (s || null));
    const right = rowCodes.slice(2, 4).map((s) => (s || null));

    rows.push({ left, right });
  }

  return {
    rows,
    frontLeft: GUIDE_SEAT,
    totalSeats,
    guideSeats: [GUIDE_SEAT],
  };
}

export const BUS_LAYOUT = generateBusLayout(30);
