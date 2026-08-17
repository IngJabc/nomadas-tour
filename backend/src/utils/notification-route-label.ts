/**
 * In-app notification route display: destination only (origin stays in metadata/DB).
 */
export function notificationDestinationLabel(
  destination: string | null | undefined,
  fallback = 'viaje',
): string {
  const dest = typeof destination === 'string' ? destination.trim() : '';
  return dest || fallback;
}
