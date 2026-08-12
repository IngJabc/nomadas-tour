import { supabaseAdmin } from '../config/database.js';
import { env } from '../config/env.js';
import { formatDateForEmail } from '../utils/email-fanout.js';
import { businessDayBoundsUtc } from '../utils/timezone.js';

/** D3 — upcoming trips window and row cap. */
export const AGENCY_DIGEST_UPCOMING_HOURS = 48;
export const AGENCY_DIGEST_UPCOMING_LIMIT = 10;

export interface AgencyDigestUpcomingTrip {
  trip_id: string;
  route_label: string;
  departure_time: string;
  departure_formatted: string;
  reservation_count: number;
  capacity: number;
  available_seats: number;
  occupancy_pct: number;
}

export interface AgencyDigestAggregates {
  agency_id: string;
  agency_name: string;
  agency_email: string;
  digest_date: string;
  active_trips: number;
  today_reservations: number;
  pending_boarding_passengers: number;
  upcoming_trips: AgencyDigestUpcomingTrip[];
  dashboard_url: string;
}

/**
 * Load digest aggregates strictly scoped by agency_id.
 * Excludes activity timelines and passenger/booker PII fields.
 */
export async function loadAgencyDigestAggregates(
  agencyId: string,
  digestDate: string,
  now: Date = new Date(),
): Promise<AgencyDigestAggregates | null> {
  const { data: agency, error: agencyError } = await supabaseAdmin
    .from('agencies')
    .select('id, name, email, status')
    .eq('id', agencyId)
    .maybeSingle();

  if (agencyError) {
    throw new Error(`loadAgencyDigestAggregates agency: ${agencyError.message}`);
  }
  if (!agency) return null;

  const agencyRow = agency as {
    id: string;
    name: string;
    email: string | null;
    status: string;
  };

  if (agencyRow.status !== 'active' || !agencyRow.email?.trim()) {
    return null;
  }

  const { startIso, endIsoExclusive } = businessDayBoundsUtc(digestDate);
  const windowEnd = new Date(
    now.getTime() + AGENCY_DIGEST_UPCOMING_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const nowIso = now.toISOString();

  const [
    { count: activeTrips, error: activeErr },
    { count: todayReservations, error: todayErr },
    { data: pendingPassengers, error: pendingErr },
    { data: upcomingTrips, error: upcomingErr },
  ] = await Promise.all([
    supabaseAdmin
      .from('trip_agencies')
      .select('*, trips!inner(id)', { count: 'exact', head: true })
      .eq('agency_id', agencyId)
      .eq('trips.status', 'active'),
    supabaseAdmin
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('agency_id', agencyId)
      .gte('created_at', startIso)
      .lt('created_at', endIsoExclusive),
    supabaseAdmin
      .from('reservation_passengers')
      .select('id, reservations!inner(agency_id)')
      .eq('boarded', false)
      .eq('status', 'active')
      .eq('reservations.agency_id', agencyId),
    supabaseAdmin
      .from('trips')
      .select(
        'id, departure_time, capacity, routes(origin, destination), trip_agencies!inner(agency_id)',
      )
      .eq('trip_agencies.agency_id', agencyId)
      .eq('status', 'active')
      .gte('departure_time', nowIso)
      .lt('departure_time', windowEnd)
      .order('departure_time', { ascending: true })
      .limit(AGENCY_DIGEST_UPCOMING_LIMIT),
  ]);

  if (activeErr) throw new Error(`active_trips: ${activeErr.message}`);
  if (todayErr) throw new Error(`today_reservations: ${todayErr.message}`);
  if (pendingErr) throw new Error(`pending_boarding: ${pendingErr.message}`);
  if (upcomingErr) throw new Error(`upcoming_trips: ${upcomingErr.message}`);

  const upcoming: AgencyDigestUpcomingTrip[] = [];
  const tripRows = (upcomingTrips ?? []) as unknown as Array<{
    id: string;
    departure_time: string;
    capacity: number | null;
    routes: { origin: string; destination: string } | null;
  }>;

  if (tripRows.length > 0) {
    const tripIds = tripRows.map((t) => t.id);
    const [{ data: reservationCounts }, { data: seatCounts }] =
      await Promise.all([
        supabaseAdmin
          .from('reservations')
          .select('trip_id')
          .in('trip_id', tripIds)
          .eq('agency_id', agencyId)
          .in('status', ['confirmed', 'partial', 'completed', 'boarded']),
        supabaseAdmin
          .from('seats')
          .select('trip_id, status')
          .in('trip_id', tripIds),
      ]);

    const countMap: Record<string, number> = {};
    for (const r of reservationCounts || []) {
      countMap[r.trip_id] = (countMap[r.trip_id] || 0) + 1;
    }

    const seatMap: Record<string, { total: number; available: number; reserved: number }> =
      {};
    for (const s of seatCounts || []) {
      if (!seatMap[s.trip_id]) {
        seatMap[s.trip_id] = { total: 0, available: 0, reserved: 0 };
      }
      seatMap[s.trip_id].total++;
      if (s.status === 'available') seatMap[s.trip_id].available++;
      else seatMap[s.trip_id].reserved++;
    }

    for (const t of tripRows) {
      const seats = seatMap[t.id] || {
        total: t.capacity || 0,
        available: 0,
        reserved: 0,
      };
      const total = seats.total || t.capacity || 0;
      const route = t.routes;
      upcoming.push({
        trip_id: t.id,
        route_label: `${route?.origin || '?'} → ${route?.destination || '?'}`,
        departure_time: t.departure_time,
        departure_formatted: formatDateForEmail(t.departure_time),
        reservation_count: countMap[t.id] || 0,
        capacity: total,
        available_seats: seats.available,
        occupancy_pct:
          total > 0 ? Math.round((seats.reserved / total) * 100) : 0,
      });
    }
  }

  const frontend = env.FRONTEND_URL.replace(/\/$/, '');

  return {
    agency_id: agencyId,
    agency_name: agencyRow.name || 'Agencia',
    agency_email: agencyRow.email.trim(),
    digest_date: digestDate,
    active_trips: activeTrips || 0,
    today_reservations: todayReservations || 0,
    pending_boarding_passengers: pendingPassengers?.length ?? 0,
    upcoming_trips: upcoming,
    dashboard_url: `${frontend}/agency`,
  };
}
