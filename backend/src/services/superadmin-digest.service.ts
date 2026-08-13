import { supabaseAdmin } from '../config/database.js';
import { env } from '../config/env.js';
import { formatDateForEmail } from '../utils/email-fanout.js';
import { businessDayBoundsUtc } from '../utils/timezone.js';

/** S4 / S6 — upcoming trips window and row cap. */
export const SUPERADMIN_DIGEST_UPCOMING_HOURS = 48;
export const SUPERADMIN_DIGEST_UPCOMING_LIMIT = 10;
export const SUPERADMIN_DIGEST_OCCUPANCY_LIMIT = 10;

/** Synthetic emails from 035_backfill_users_from_auth — never deliver. */
export const IDENTITY_GAP_EMAIL_DOMAIN = 'identity-gap.nomadas.local';

export interface SuperadminDigestUpcomingTrip {
  trip_id: string;
  route_label: string;
  departure_time: string;
  departure_formatted: string;
  reservation_count: number;
  capacity: number;
  available_seats: number;
  occupancy_pct: number;
}

export interface SuperadminDigestOccupancyRow {
  trip_id: string;
  label: string;
  departure: string;
  total: number;
  reserved: number;
  occupancy_pct: number;
}

export interface SuperadminDigestAggregates {
  digest_date: string;
  total_agencies: number;
  active_agencies: number;
  active_trips: number;
  today_reservations: number;
  pending_boarding_passengers: number;
  upcoming_trips: SuperadminDigestUpcomingTrip[];
  occupancy_by_trip: SuperadminDigestOccupancyRow[];
  dashboard_url: string;
}

export interface SuperadminDigestRecipient {
  user_id: string;
  email: string;
}

export function isSyntheticIdentityGapEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith(`@${IDENTITY_GAP_EMAIL_DOMAIN}`);
}

export function isEligibleSuperadminEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed === '') return false;
  if (isSyntheticIdentityGapEmail(trimmed)) return false;
  return true;
}

/**
 * Empty digest (S7): occupancy_by_trip does not decide emptiness.
 */
export function isSuperadminDigestEmpty(
  aggregates: SuperadminDigestAggregates,
): boolean {
  return (
    aggregates.active_trips === 0 &&
    aggregates.today_reservations === 0 &&
    aggregates.pending_boarding_passengers === 0 &&
    aggregates.upcoming_trips.length === 0
  );
}

/**
 * Superadmins eligible for the daily email:
 * role=superadmin, non-empty email, not identity-gap, pref email_enabled.
 * Missing pref row is treated as enabled (table default TRUE).
 */
export async function loadEligibleSuperadmins(): Promise<
  SuperadminDigestRecipient[]
> {
  const { data: users, error: usersError } = await supabaseAdmin
    .from('users')
    .select('id, email, role')
    .eq('role', 'superadmin');

  if (usersError) {
    throw new Error(`loadEligibleSuperadmins users: ${usersError.message}`);
  }

  const candidates = ((users ?? []) as Array<{
    id: string;
    email: string | null;
    role: string;
  }>).filter(
    (u) => u.role === 'superadmin' && isEligibleSuperadminEmail(u.email),
  );

  if (candidates.length === 0) return [];

  const ids = candidates.map((u) => u.id);
  const { data: prefs, error: prefsError } = await supabaseAdmin
    .from('superadmin_notification_preferences')
    .select('user_id, email_enabled, category')
    .eq('category', 'superadmin_digest')
    .in('user_id', ids);

  if (prefsError) {
    throw new Error(`loadEligibleSuperadmins prefs: ${prefsError.message}`);
  }

  const enabledByUser = new Map<string, boolean>();
  for (const row of (prefs ?? []) as Array<{
    user_id: string;
    email_enabled: boolean;
    category: string;
  }>) {
    enabledByUser.set(row.user_id, row.email_enabled !== false);
  }

  return candidates
    .filter((u) => enabledByUser.get(u.id) !== false)
    .map((u) => ({
      user_id: u.id,
      email: u.email!.trim(),
    }));
}

/**
 * Global platform aggregates for F4-002. Own queries — does not call getDashboard().
 * today_reservations uses America/Caracas day bounds.
 */
export async function loadSuperadminDigestAggregates(
  digestDate: string,
  now: Date = new Date(),
): Promise<SuperadminDigestAggregates> {
  const { startIso, endIsoExclusive } = businessDayBoundsUtc(digestDate);
  const windowEnd = new Date(
    now.getTime() + SUPERADMIN_DIGEST_UPCOMING_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const nowIso = now.toISOString();

  const [
    { count: totalAgencies, error: totalAgenciesErr },
    { count: activeAgencies, error: activeAgenciesErr },
    { count: activeTrips, error: activeTripsErr },
    { count: todayReservations, error: todayErr },
    { data: pendingPassengers, error: pendingErr },
    { data: upcomingTrips, error: upcomingErr },
    { data: occupancyTrips, error: occupancyErr },
  ] = await Promise.all([
    supabaseAdmin.from('agencies').select('*', { count: 'exact', head: true }),
    supabaseAdmin
      .from('agencies')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabaseAdmin
      .from('trips')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabaseAdmin
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startIso)
      .lt('created_at', endIsoExclusive),
    supabaseAdmin
      .from('reservation_passengers')
      .select('id')
      .eq('boarded', false)
      .eq('status', 'active'),
    supabaseAdmin
      .from('trips')
      .select('id, departure_time, capacity, routes(origin, destination)')
      .eq('status', 'active')
      .gte('departure_time', nowIso)
      .lt('departure_time', windowEnd)
      .order('departure_time', { ascending: true })
      .limit(SUPERADMIN_DIGEST_UPCOMING_LIMIT),
    supabaseAdmin
      .from('trips')
      .select('id, capacity, departure_time, routes(origin, destination)')
      .in('status', ['active', 'completed'])
      .order('departure_time', { ascending: false })
      .limit(SUPERADMIN_DIGEST_OCCUPANCY_LIMIT),
  ]);

  if (totalAgenciesErr) {
    throw new Error(`total_agencies: ${totalAgenciesErr.message}`);
  }
  if (activeAgenciesErr) {
    throw new Error(`active_agencies: ${activeAgenciesErr.message}`);
  }
  if (activeTripsErr) {
    throw new Error(`active_trips: ${activeTripsErr.message}`);
  }
  if (todayErr) throw new Error(`today_reservations: ${todayErr.message}`);
  if (pendingErr) throw new Error(`pending_boarding: ${pendingErr.message}`);
  if (upcomingErr) throw new Error(`upcoming_trips: ${upcomingErr.message}`);
  if (occupancyErr) throw new Error(`occupancy_by_trip: ${occupancyErr.message}`);

  const upcoming = await buildUpcomingRows(
    (upcomingTrips ?? []) as unknown as TripRouteRow[],
  );
  const occupancy = await buildOccupancyRows(
    (occupancyTrips ?? []) as unknown as TripRouteRow[],
  );

  const frontend = env.FRONTEND_URL.replace(/\/$/, '');

  return {
    digest_date: digestDate,
    total_agencies: totalAgencies || 0,
    active_agencies: activeAgencies || 0,
    active_trips: activeTrips || 0,
    today_reservations: todayReservations || 0,
    pending_boarding_passengers: pendingPassengers?.length ?? 0,
    upcoming_trips: upcoming,
    occupancy_by_trip: occupancy,
    dashboard_url: `${frontend}/admin`,
  };
}

interface TripRouteRow {
  id: string;
  departure_time: string;
  capacity: number | null;
  routes: { origin: string; destination: string } | null;
}

async function buildUpcomingRows(
  tripRows: TripRouteRow[],
): Promise<SuperadminDigestUpcomingTrip[]> {
  if (tripRows.length === 0) return [];

  const tripIds = tripRows.map((t) => t.id);
  const [{ data: reservationCounts }, { data: seatCounts }] = await Promise.all([
    supabaseAdmin
      .from('reservations')
      .select('trip_id')
      .in('trip_id', tripIds)
      .in('status', ['confirmed', 'partial', 'completed', 'boarded']),
    supabaseAdmin.from('seats').select('trip_id, status').in('trip_id', tripIds),
  ]);

  const countMap: Record<string, number> = {};
  for (const r of reservationCounts || []) {
    countMap[r.trip_id] = (countMap[r.trip_id] || 0) + 1;
  }

  const seatMap: Record<
    string,
    { total: number; available: number; reserved: number }
  > = {};
  for (const s of seatCounts || []) {
    if (!seatMap[s.trip_id]) {
      seatMap[s.trip_id] = { total: 0, available: 0, reserved: 0 };
    }
    seatMap[s.trip_id].total++;
    if (s.status === 'available') seatMap[s.trip_id].available++;
    else seatMap[s.trip_id].reserved++;
  }

  return tripRows.map((t) => {
    const seats = seatMap[t.id] || {
      total: t.capacity || 0,
      available: 0,
      reserved: 0,
    };
    const total = seats.total || t.capacity || 0;
    const route = t.routes;
    return {
      trip_id: t.id,
      route_label: `${route?.origin || '?'} → ${route?.destination || '?'}`,
      departure_time: t.departure_time,
      departure_formatted: formatDateForEmail(t.departure_time),
      reservation_count: countMap[t.id] || 0,
      capacity: total,
      available_seats: seats.available,
      occupancy_pct: total > 0 ? Math.round((seats.reserved / total) * 100) : 0,
    };
  });
}

async function buildOccupancyRows(
  tripRows: TripRouteRow[],
): Promise<SuperadminDigestOccupancyRow[]> {
  if (tripRows.length === 0) return [];

  const tripIds = tripRows.map((t) => t.id);
  const { data: allSeats } = await supabaseAdmin
    .from('seats')
    .select('trip_id, status')
    .in('trip_id', tripIds);

  const tripSeatMap: Record<string, { total: number; reserved: number }> = {};
  for (const id of tripIds) {
    tripSeatMap[id] = { total: 0, reserved: 0 };
  }
  for (const s of allSeats || []) {
    if (tripSeatMap[s.trip_id]) {
      tripSeatMap[s.trip_id].total++;
      if (s.status !== 'available') tripSeatMap[s.trip_id].reserved++;
    }
  }

  return tripRows.map((t) => {
    const stats = tripSeatMap[t.id] || {
      total: t.capacity || 0,
      reserved: 0,
    };
    const total = stats.total || t.capacity || 0;
    const route = t.routes;
    return {
      trip_id: t.id,
      label: `${route?.origin || '?'} → ${route?.destination || '?'}`,
      departure: t.departure_time,
      total,
      reserved: stats.reserved,
      occupancy_pct: total > 0 ? Math.round((stats.reserved / total) * 100) : 0,
    };
  });
}
