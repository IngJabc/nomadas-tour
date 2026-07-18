const SEAT_FALLBACK = '\uffff';

/**
 * Sorts passengers by seat code using natural numeric ordering (A1, A2, ..., A10).
 * Items without a seat code are pushed to the end.
 *
 * Default getter assumes the standard Supabase join shape: { seats?: { seat_code } }
 * Pass a custom getter for flat or pre-transformed shapes.
 */
export function sortBySeatCode<T>(
  items: T[],
  getCode?: (item: T) => string | null | undefined
): T[] {
  const get = getCode ?? ((item: any) => item.seats?.seat_code as string | null | undefined);
  return [...items].sort((a, b) =>
    (get(a) ?? SEAT_FALLBACK).localeCompare(get(b) ?? SEAT_FALLBACK, undefined, { numeric: true })
  );
}
