import { supabaseAdmin } from '../config/database.js';
import type { OccupancyAlertType } from '../events/trip-occupancy-alert-due.v1.js';

export const NEAR_FULL_TRIGGER = 90;
export const NEAR_FULL_RESET = 85;
export const UNDERBOOKED_TRIGGER = 20;
export const UNDERBOOKED_RESET = 25;

export type OccupancyAlertPersistedState =
  | 'NORMAL'
  | 'NEAR_FULL_ALERTED'
  | 'UNDERBOOKED_ALERTED';

export type OccupancyComputation =
  | {
      ok: true;
      reserved: number;
      total: number;
      available: number;
      occupancy_pct: number;
    }
  | {
      ok: false;
      reason: 'total_lte_zero' | 'reserved_gt_total';
      reserved: number;
      total: number;
    };

export type OccupancyTransitionDecision =
  | { kind: 'enter'; alertType: OccupancyAlertType }
  | { kind: 'reset' }
  | { kind: 'noop' }
  | { kind: 'skip_invalid'; reason: 'total_lte_zero' | 'reserved_gt_total' };

export interface AgencyOccupancyAlertRow {
  trip_id: string;
  alert_type: OccupancyAlertType;
  origin: string;
  destination: string;
  departure_time: string;
  occupancy_pct: number;
  capacity: number;
  reserved: number;
  available: number;
  /** F4-004 — derived at read time: departure within T-24h. */
  urgency: boolean;
}

/** T-24h window constant (ms). Matches SQL INTERVAL '24 hours'. */
export const OCCUPANCY_URGENCY_WINDOW_MS = 86_400_000;

export function isOccupancyUrgency(
  departureTimeIso: string,
  nowMs: number = Date.now(),
): boolean {
  const departureMs = Date.parse(departureTimeIso);
  if (!Number.isFinite(departureMs)) return false;
  const delta = departureMs - nowMs;
  return delta > 0 && delta <= OCCUPANCY_URGENCY_WINDOW_MS;
}

/**
 * Canonical F4-003 occupancy:
 * reserved = seats.status != 'available'
 * total    = seat rows, fallback to trips.capacity if no rows
 * occupancy_pct = round(reserved / total * 100)
 */
export function classifyOccupancyCounts(
  reserved: number,
  total: number,
): OccupancyComputation {
  if (total <= 0) {
    return { ok: false, reason: 'total_lte_zero', reserved, total };
  }
  if (reserved > total) {
    return { ok: false, reason: 'reserved_gt_total', reserved, total };
  }

  return {
    ok: true,
    reserved,
    total,
    available: total - reserved,
    occupancy_pct: Math.round((reserved / total) * 100),
  };
}

export function computeCanonicalOccupancy(
  seats: Array<{ status: string }>,
  capacityFallback: number,
): OccupancyComputation {
  const seatRows = seats.length;
  const reserved = seats.filter((s) => s.status !== 'available').length;
  const total = seatRows === 0 ? capacityFallback : seatRows;
  return classifyOccupancyCounts(reserved, total);
}

/**
 * One transition per evaluation. Exit rule of the current state only.
 * NEAR_FULL_ALERTED + 15% → reset (NORMAL). Underbooked waits for the next tick.
 */
export function decideOccupancyTransition(
  state: OccupancyAlertPersistedState,
  occupancy: OccupancyComputation,
): OccupancyTransitionDecision {
  if (!occupancy.ok) {
    return { kind: 'skip_invalid', reason: occupancy.reason };
  }

  const pct = occupancy.occupancy_pct;

  if (state === 'NORMAL') {
    if (pct >= NEAR_FULL_TRIGGER) return { kind: 'enter', alertType: 'near_full' };
    if (pct <= UNDERBOOKED_TRIGGER) {
      return { kind: 'enter', alertType: 'underbooked' };
    }
    return { kind: 'noop' };
  }

  if (state === 'NEAR_FULL_ALERTED') {
    return pct < NEAR_FULL_RESET ? { kind: 'reset' } : { kind: 'noop' };
  }

  return pct > UNDERBOOKED_RESET ? { kind: 'reset' } : { kind: 'noop' };
}

export function persistedStateFromAlertType(
  alertType: OccupancyAlertType | null | undefined,
): OccupancyAlertPersistedState {
  if (alertType === 'near_full') return 'NEAR_FULL_ALERTED';
  if (alertType === 'underbooked') return 'UNDERBOOKED_ALERTED';
  return 'NORMAL';
}

export async function listAgencyOccupancyAlerts(
  agencyId: string,
): Promise<AgencyOccupancyAlertRow[]> {
  const { data: assigned, error: assignedErr } = await supabaseAdmin
    .from('trip_agencies')
    .select('trip_id')
    .eq('agency_id', agencyId);
  if (assignedErr) {
    throw new Error(`occupancy_alerts trip_agencies: ${assignedErr.message}`);
  }

  const assignedIds = (assigned ?? []).map((row) => row.trip_id as string);
  if (assignedIds.length === 0) return [];

  const { data: states, error: stateErr } = await supabaseAdmin
    .from('trip_occupancy_alert_state')
    .select('trip_id, alert_type')
    .in('trip_id', assignedIds);
  if (stateErr) {
    throw new Error(`occupancy_alerts state: ${stateErr.message}`);
  }

  const stateByTrip = new Map<string, OccupancyAlertType>();
  for (const row of states ?? []) {
    if (row.alert_type === 'near_full' || row.alert_type === 'underbooked') {
      stateByTrip.set(row.trip_id as string, row.alert_type);
    }
  }
  const alertedIds = [...stateByTrip.keys()];
  if (alertedIds.length === 0) return [];

  const nowIso = new Date().toISOString();
  const { data: trips, error: tripErr } = await supabaseAdmin
    .from('trips')
    .select('id, capacity, departure_time, routes(origin, destination)')
    .in('id', alertedIds)
    .eq('status', 'active')
    .gt('departure_time', nowIso)
    .order('departure_time', { ascending: true });
  if (tripErr) {
    throw new Error(`occupancy_alerts trips: ${tripErr.message}`);
  }
  if (!trips || trips.length === 0) return [];

  const liveIds = trips.map((t) => t.id as string);
  const { data: seats, error: seatErr } = await supabaseAdmin
    .from('seats')
    .select('trip_id, status')
    .in('trip_id', liveIds);
  if (seatErr) {
    throw new Error(`occupancy_alerts seats: ${seatErr.message}`);
  }

  const seatsByTrip = new Map<string, Array<{ status: string }>>();
  for (const seat of seats ?? []) {
    const list = seatsByTrip.get(seat.trip_id as string) ?? [];
    list.push({ status: seat.status as string });
    seatsByTrip.set(seat.trip_id as string, list);
  }

  const rows: AgencyOccupancyAlertRow[] = [];
  const nowMs = Date.now();
  for (const trip of trips) {
    const alertType = stateByTrip.get(trip.id as string);
    if (!alertType) continue;

    const route = (trip as { routes?: { origin?: string; destination?: string } | { origin?: string; destination?: string }[] }).routes;
    const routeRow = Array.isArray(route) ? route[0] : route;
    const occupancy = computeCanonicalOccupancy(
      seatsByTrip.get(trip.id as string) ?? [],
      Number(trip.capacity) || 0,
    );
    if (!occupancy.ok) continue;

    const departure_time = trip.departure_time as string;
    rows.push({
      trip_id: trip.id as string,
      alert_type: alertType,
      origin: routeRow?.origin || '?',
      destination: routeRow?.destination || '?',
      departure_time,
      occupancy_pct: occupancy.occupancy_pct,
      capacity: occupancy.total,
      reserved: occupancy.reserved,
      available: occupancy.available,
      urgency: isOccupancyUrgency(departure_time, nowMs),
    });
  }

  // Urgents first, then departure ASC within each group (trips already ASC).
  rows.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency ? -1 : 1;
    return (
      Date.parse(a.departure_time) - Date.parse(b.departure_time) ||
      a.trip_id.localeCompare(b.trip_id)
    );
  });

  return rows;
}
