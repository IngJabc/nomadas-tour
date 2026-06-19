import { BusRow } from '@/types';

export const GUIDE_SEAT = 'G';

export function generateBusLayout(totalSeats: number): { rows: BusRow[]; frontLeft: string; totalSeats: number; guideSeats: string[] } {
  // Pattern: N rows, each row has 4 seats (2L + 2R), front row has door (0L + 2R)
  // Total = (rows - 1) * 4 + 2 = rows * 4 - 2
  // rows = ceil((totalSeats + 2) / 4)
  const rows = Math.max(2, Math.ceil((totalSeats + 2) / 4));
  const rightSeatsPerRow = 2;
  const leftSeatsPerRow = 2;

  // Right side: A1, A2 at front, then A3, A4... upward
  // Left side: A(N-...)... upward
  const rightSeats: string[] = [];
  const leftSeats: string[] = [];

  for (let i = 1; i <= totalSeats; i++) {
    const code = `A${i}`;
    // First 2*rows seats go to right (A1, A2 front row, rest upward)
    // Actually: right seats are A1 to A(rows*2), left seats are rest
    if (i <= rows * rightSeatsPerRow) {
      rightSeats.push(code);
    } else {
      leftSeats.push(code);
    }
  }

  const result: BusRow[] = [];

  // Build rows from back to front
  for (let r = 0; r < rows; r++) {
    const isFrontRow = r === rows - 1;

    // Right: front row has A1, A2; next row back has A3, A4; etc.
    const rightStart = (rows - 1 - r) * rightSeatsPerRow;
    const rightRow = rightSeats.slice(rightStart, rightStart + rightSeatsPerRow);
    // Pad with null if not enough seats
    while (rightRow.length < rightSeatsPerRow) rightRow.push('');

    let leftRow: (string | null)[];
    if (isFrontRow) {
      // Front row has door on left
      leftRow = [null, null];
    } else {
      // Left: top half goes to back rows
      const leftIndex = r * leftSeatsPerRow;
      const leftCodes = leftSeats.slice(leftIndex, leftIndex + leftSeatsPerRow);
      // Reverse so larger numbers are at back
      const row = leftCodes.reverse();
      while (row.length < leftSeatsPerRow) row.push('');
      leftRow = row;
    }

    result.push({ left: leftRow, right: rightRow });
  }

  return {
    rows: result,
    frontLeft: GUIDE_SEAT,
    totalSeats,
    guideSeats: [GUIDE_SEAT],
  };
}

// Default layout for backward compatibility
export const BUS_LAYOUT = generateBusLayout(30);
