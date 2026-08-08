/**
 * Shared email helpers for trip / agency fan-out.
 * Extracted from SuperadminService (WKR-007 Fase 0) — zero behavior change.
 */
import { supabaseAdmin } from '../config/database.js';

export async function getAgenciesWithEmail(
  agencyIds: string[],
): Promise<{ id: string; name: string; email: string }[]> {
  if (agencyIds.length === 0) return [];

  const { data: agencies } = await supabaseAdmin
    .from('agencies')
    .select('id, name, email, status')
    .in('id', agencyIds);

  return (agencies || []).filter(
    (a: any) => a.status === 'active' && a.email,
  );
}

export function formatDateForEmail(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('es-VE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Caracas',
  });
}
