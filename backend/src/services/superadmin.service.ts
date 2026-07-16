import { supabaseAdmin } from '../config/database.js';
import { generateUniqueSubdomain } from '../utils/subdomain.js';
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '../errors/index.js';
import { generateToken } from '../utils/token.js';
import { toUTC } from '../utils/timezone.js';

export class SuperadminService {
  // ---- Agencies ----
  async listAgencies() {
    const { data: agencies, error } = await supabaseAdmin
      .from('agencies')
      .select('*')
      .order('name');

    if (error) throw new ValidationError(error.message);
    if (!agencies || agencies.length === 0) return [];

    const agencyIds = agencies.map((a: any) => a.id);

    // Get trip count per agency via trip_agencies junction
    const { data: tripLinks } = await supabaseAdmin
      .from('trip_agencies')
      .select('agency_id, trip_id')
      .in('agency_id', agencyIds);

    const tripCountByAgency: Record<string, number> = {};
    const allTripIds: string[] = [];
    for (const tl of tripLinks || []) {
      tripCountByAgency[tl.agency_id] = (tripCountByAgency[tl.agency_id] || 0) + 1;
      allTripIds.push(tl.trip_id);
    }

    // Get reservation count per trip for these agencies
    let reservationCountByTrip: Record<string, number> = {};
    if (allTripIds.length > 0) {
      const { data: reservations } = await supabaseAdmin
        .from('reservations')
        .select('trip_id, agency_id')
        .in('trip_id', [...new Set(allTripIds)])
        .in('status', ['confirmed', 'partial', 'completed', 'boarded']);
      for (const r of reservations || []) {
        reservationCountByTrip[`${r.trip_id}:${r.agency_id}`] =
          (reservationCountByTrip[`${r.trip_id}:${r.agency_id}`] || 0) + 1;
      }
    }

    // Aggregate reservation count per agency
    const reservationCountByAgency: Record<string, number> = {};
    for (const tl of tripLinks || []) {
      const key = `${tl.trip_id}:${tl.agency_id}`;
      if (reservationCountByTrip[key]) {
        reservationCountByAgency[tl.agency_id] =
          (reservationCountByAgency[tl.agency_id] || 0) + reservationCountByTrip[key];
      }
    }

    return agencies.map((agency: any) => ({
      ...agency,
      tripCount: tripCountByAgency[agency.id] || 0,
      reservationCount: reservationCountByAgency[agency.id] || 0,
    }));
  }

  async getAgency(id: string) {
    const { data, error } = await supabaseAdmin
      .from('agencies')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundError('Agency not found');
    return data;
  }

  async createAgency(name: string, email: string, createdBy: string) {
    const subdomain = await generateUniqueSubdomain(name, supabaseAdmin);

    const { data: agency, error: agencyError } = await supabaseAdmin
      .from('agencies')
      .insert({ name, subdomain, email, status: 'pending' })
      .select()
      .single();

    if (agencyError) throw new ValidationError(agencyError.message);

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const { error: inviteError } = await supabaseAdmin
      .from('agency_invitations')
      .insert({ token, agency_id: agency.id, email, expires_at: expiresAt });

    if (inviteError) throw new ValidationError(inviteError.message);

    return { ...agency, invitation_link: `/accept-invitation?token=${token}` };
  }

  async updateAgency(id: string, updates: { name?: string; status?: string }) {
    const { data, error } = await supabaseAdmin
      .from('agencies')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new ValidationError(error.message);
    if (!data) throw new NotFoundError('Agency not found');
    return data;
  }

  // ---- Routes ----
  async listRoutes() {
    const { data: routes, error } = await supabaseAdmin
      .from('routes')
      .select('*')
      .order('origin');

    if (error) throw new ValidationError(error.message);
    if (!routes || routes.length === 0) return [];

    const routeIds = routes.map((r: any) => r.id);

    const { data: trips } = await supabaseAdmin
      .from('trips')
      .select('id, route_id')
      .in('route_id', routeIds);

    const tripCountByRoute: Record<string, number> = {};
    const allTripIds: string[] = [];
    for (const t of trips || []) {
      tripCountByRoute[t.route_id] = (tripCountByRoute[t.route_id] || 0) + 1;
      allTripIds.push(t.id);
    }

    let reservationCountByTrip: Record<string, number> = {};
    if (allTripIds.length > 0) {
      const { data: reservations } = await supabaseAdmin
        .from('reservations')
        .select('trip_id')
        .in('trip_id', allTripIds)
        .in('status', ['confirmed', 'partial', 'completed', 'boarded']);
      for (const r of reservations || []) {
        reservationCountByTrip[r.trip_id] = (reservationCountByTrip[r.trip_id] || 0) + 1;
      }
    }

    const tripIdsByRoute: Record<string, string[]> = {};
    for (const t of trips || []) {
      if (!tripIdsByRoute[t.route_id]) tripIdsByRoute[t.route_id] = [];
      tripIdsByRoute[t.route_id].push(t.id);
    }

    return routes.map((route: any) => {
      const routeTripIds = tripIdsByRoute[route.id] || [];
      const tripCount = routeTripIds.length;
      const reservationCount = routeTripIds.reduce(
        (sum, tid) => sum + (reservationCountByTrip[tid] || 0), 0
      );
      return { ...route, tripCount, reservationCount };
    });
  }

  async createRoute(origin: string, destination: string) {
    const { data, error } = await supabaseAdmin
      .from('routes')
      .insert({ origin, destination })
      .select()
      .single();

    if (error) throw new ValidationError(error.message);
    return data;
  }

  async updateRoute(id: string, updates: { origin?: string; destination?: string }) {
    const { data: existing } = await supabaseAdmin
      .from('routes')
      .select('id')
      .eq('id', id)
      .single();

    if (!existing) throw new NotFoundError('Route not found');

    const { data: trips } = await supabaseAdmin
      .from('trips')
      .select('id')
      .eq('route_id', id);

    if (trips && trips.length > 0) {
      const tripIds = trips.map(t => t.id);
      const { count } = await supabaseAdmin
        .from('reservations')
        .select('*', { count: 'exact', head: true })
        .in('trip_id', tripIds)
        .in('status', ['confirmed', 'partial', 'completed', 'boarded']);

      if (count && count > 0) {
        throw new ForbiddenError('No puedes editar esta ruta porque tiene reservas asociadas.');
      }
    }

    const { data, error } = await supabaseAdmin
      .from('routes')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new ValidationError(error.message);
    return data;
  }

  async deactivateRoute(id: string) {
    const { data: existing } = await supabaseAdmin
      .from('routes')
      .select('id, status')
      .eq('id', id)
      .single();

    if (!existing) throw new NotFoundError('Route not found');

    if (existing.status === 'inactive') {
      throw new ValidationError('La ruta ya está inactiva.');
    }

    const { data: trips } = await supabaseAdmin
      .from('trips')
      .select('id, status')
      .eq('route_id', id);

    if (trips && trips.length > 0) {
      const activeTrips = trips.filter(t => t.status === 'active');
      if (activeTrips.length > 0) {
        throw new ForbiddenError('No puedes desactivar esta ruta porque tiene viajes activos. Cancela o completa los viajes primero.');
      }
    }

    const { error } = await supabaseAdmin
      .from('routes')
      .update({ status: 'inactive' })
      .eq('id', id);

    if (error) throw new ValidationError(error.message);
  }

  async activateRoute(id: string) {
    const { data: existing } = await supabaseAdmin
      .from('routes')
      .select('id, status')
      .eq('id', id)
      .single();

    if (!existing) throw new NotFoundError('Route not found');

    if (existing.status === 'active') {
      throw new ValidationError('La ruta ya está activa.');
    }

    const { error } = await supabaseAdmin
      .from('routes')
      .update({ status: 'active' })
      .eq('id', id);

    if (error) throw new ValidationError(error.message);
  }

  // ---- Auto-complete expired trips ----
  async autoCompleteExpiredTrips() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin
      .from('trips')
      .update({ status: 'completed' })
      .eq('status', 'active')
      .lt('departure_time', cutoff);

    if (error) throw new ValidationError(error.message);
  }

  // ---- Vehicle config ----
  private readonly VEHICLE_CONFIG: Record<string, { capacity: number; seats: string[] }> = {
    bus: {
      capacity: 31,
      seats: ['A1','A2','A3','A4','A5','A6','A7','A8','A9','A10','A11','A12','A13','A14','A15','A16','A17','A18','A19','A20','A21','A22','A23','A24','A25','A26','A27','A28','A29','A30','A31'],
    },
    kia: {
      capacity: 10,
      seats: ['A1','A2','A3','A4','A5','A6','A7','A8','A9','A10'],
    },
  };

  // ---- Trips (atomic: trip + seats + allocations) ----
  async createTrip(
    routeId: string,
    departureTime: string,
    vehicleType: 'bus' | 'kia',
    agencyIds: string[],
    createdBy: string,
  ) {
    if (agencyIds.length === 0) {
      throw new ValidationError('At least one agency is required');
    }

    const config = this.VEHICLE_CONFIG[vehicleType];
    const capacity = config.capacity;
    const seatCodes = config.seats;

    const { data: route } = await supabaseAdmin
      .from('routes')
      .select('id, status')
      .eq('id', routeId)
      .single();

    if (!route) throw new NotFoundError('Route not found');
    if (route.status === 'inactive') throw new ValidationError('No se puede crear un viaje con una ruta inactiva. Activa la ruta primero.');

    const { data: trip, error: tripError } = await supabaseAdmin
      .from('trips')
      .insert({
        route_id: routeId,
        departure_time: toUTC(departureTime),
        capacity,
        vehicle_type: vehicleType,
        created_by: createdBy,
      })
      .select()
      .single();

    if (tripError) throw new ValidationError(tripError.message);

    const seatRows = seatCodes.map(seatCode => ({
      trip_id: trip.id,
      seat_code: seatCode,
      status: 'available' as const,
    }));

    const { error: seatsError } = await supabaseAdmin
      .from('seats')
      .insert(seatRows);

    if (seatsError) {
      await supabaseAdmin.from('trips').delete().eq('id', trip.id);
      throw new ValidationError(seatsError.message);
    }

    const taRows = agencyIds.map(agencyId => ({
      trip_id: trip.id,
      agency_id: agencyId,
    }));

    const { error: taError } = await supabaseAdmin
      .from('trip_agencies')
      .insert(taRows);

    if (taError) {
      await supabaseAdmin.from('seats').delete().eq('trip_id', trip.id);
      await supabaseAdmin.from('trips').delete().eq('id', trip.id);
      throw new ValidationError(taError.message);
    }

    return trip;
  }

  async listTrips(
    page: number = 1,
    limit: number = 12,
    filters?: { status?: string; route_id?: string; agency_id?: string; search?: string; departure_date?: string }
  ) {
    await this.autoCompleteExpiredTrips();

    // Resolve text search to route IDs and agency IDs
    let routeIdFilter: string[] | undefined;
    let tripIdFilterFromSearch: string[] | undefined;
    if (filters?.search) {
      const { data: matchingRoutes } = await supabaseAdmin
        .from('routes')
        .select('id')
        .ilike('destination', `%${filters.search}%`);
      routeIdFilter = matchingRoutes?.map(r => r.id) || [];

      const { data: matchingAgencies } = await supabaseAdmin
        .from('agencies')
        .select('id')
        .ilike('name', `%${filters.search}%`);
      if (matchingAgencies && matchingAgencies.length > 0) {
        const agencyIds = matchingAgencies.map(a => a.id);
        const { data: agencyTrips } = await supabaseAdmin
          .from('trip_agencies')
          .select('trip_id')
          .in('agency_id', agencyIds);
        tripIdFilterFromSearch = agencyTrips?.map(t => t.trip_id) || [];
      }
    }

    // Resolve agency_id filter to trip IDs
    let tripIdFilterFromAgency: string[] | undefined;
    if (filters?.agency_id) {
      const { data: agencyTrips } = await supabaseAdmin
        .from('trip_agencies')
        .select('trip_id')
        .eq('agency_id', filters.agency_id);
      tripIdFilterFromAgency = agencyTrips?.map(t => t.trip_id) || [];
      if (tripIdFilterFromAgency.length === 0) {
        const totalPages = Math.ceil(0 / limit);
        return { data: [], pagination: { page, limit, total: 0, totalPages } };
      }
    }

    // Build id filter combining search and agency_id
    let tripIdFilter: string[] | undefined;
    if (routeIdFilter || tripIdFilterFromSearch) {
      // Search: trips matching route destination OR agency name
      const { data: tripsByRoute } = routeIdFilter && routeIdFilter.length > 0
        ? await supabaseAdmin.from('trips').select('id').in('route_id', routeIdFilter)
        : { data: [] as any[] };
      const routeTripIds = (tripsByRoute || []).map(t => t.id);
      const allIds = [...new Set([...routeTripIds, ...(tripIdFilterFromSearch || [])])];
      tripIdFilter = allIds;
      if (allIds.length === 0) {
        const totalPages = Math.ceil(0 / limit);
        return { data: [], pagination: { page, limit, total: 0, totalPages } };
      }
    }
    if (tripIdFilterFromAgency) {
      tripIdFilter = tripIdFilter
        ? tripIdFilter.filter(id => tripIdFilterFromAgency!.includes(id))
        : tripIdFilterFromAgency;
    }

    // Date filter range
    let dateStart: string | undefined;
    let dateEnd: string | undefined;
    if (filters?.departure_date) {
      const start = new Date(`${filters.departure_date}T00:00:00`);
      const end = new Date(start.getTime() + 86400000);
      dateStart = start.toISOString();
      dateEnd = end.toISOString();
    }

    // Count with filters
    let countQuery = supabaseAdmin.from('trips').select('*', { count: 'exact', head: true }) as any;
    if (filters?.status) countQuery = countQuery.eq('status', filters.status);
    if (filters?.route_id) countQuery = countQuery.eq('route_id', filters.route_id);
    if (dateStart) countQuery = countQuery.gte('departure_time', dateStart);
    if (dateEnd) countQuery = countQuery.lt('departure_time', dateEnd);
    if (tripIdFilter) countQuery = countQuery.in('id', tripIdFilter);
    const { count: total } = await countQuery;

    // Data query with filters
    let dataQuery = supabaseAdmin
      .from('trips')
      .select('*, routes(origin, destination), trip_agencies(agency_id)')
      .order('departure_time')
      .range((page - 1) * limit, page * limit - 1) as any;
    if (filters?.status) dataQuery = dataQuery.eq('status', filters.status);
    if (filters?.route_id) dataQuery = dataQuery.eq('route_id', filters.route_id);
    if (dateStart) dataQuery = dataQuery.gte('departure_time', dateStart);
    if (dateEnd) dataQuery = dataQuery.lt('departure_time', dateEnd);
    if (tripIdFilter) dataQuery = dataQuery.in('id', tripIdFilter);

    const { data: trips, error } = await dataQuery;

    const totalPages = Math.ceil((total || 0) / limit);

    if (!trips || trips.length === 0) {
      return { data: [], pagination: { page, limit, total: total || 0, totalPages } };
    }

    const tripIds = trips.map((t: any) => t.id);

    // Seat counts per trip + raw seats for frontend derivation
    const { data: seats } = await supabaseAdmin
      .from('seats')
      .select('id, trip_id, seat_code, status')
      .in('trip_id', tripIds);

    const seatMap: Record<string, { total: number; available: number; reserved: number; locked: number; blocked: number }> = {};
    const seatsByTrip: Record<string, { id: string; seat_code: string; status: string }[]> = {};
    for (const tId of tripIds) {
      seatMap[tId] = { total: 0, available: 0, reserved: 0, locked: 0, blocked: 0 };
      seatsByTrip[tId] = [];
    }
    for (const s of seats || []) {
      if (seatMap[s.trip_id]) {
        seatMap[s.trip_id].total++;
        seatsByTrip[s.trip_id].push({ id: s.id, seat_code: s.seat_code, status: s.status });
        if (s.status === 'available') seatMap[s.trip_id].available++;
        else if (s.status === 'reserved') seatMap[s.trip_id].reserved++;
        else if (s.status === 'locked') seatMap[s.trip_id].locked++;
        else if (s.status === 'blocked') seatMap[s.trip_id].blocked++;
      }
    }

    // Boarded passenger count per trip
    const { data: tripReservations } = await supabaseAdmin
      .from('reservations')
      .select('id, trip_id')
      .in('trip_id', tripIds);

    const tripResIds = (tripReservations || []).map(r => r.id);
    const tripForRes = new Map((tripReservations || []).map(r => [r.id, r.trip_id]));
    const boardedPerTrip: Record<string, number> = {};

    if (tripResIds.length > 0) {
      const { data: boardedPassengers } = await supabaseAdmin
        .from('reservation_passengers')
        .select('reservation_id')
        .eq('boarded', true)
        .in('reservation_id', tripResIds);

      for (const bp of boardedPassengers || []) {
        const tId = tripForRes.get(bp.reservation_id);
        if (tId) boardedPerTrip[tId] = (boardedPerTrip[tId] || 0) + 1;
      }
    }

    // Reservation count per agency per trip
    const { data: reservations } = await supabaseAdmin
      .from('reservations')
      .select('id, trip_id, agency_id')
      .in('trip_id', tripIds)
      .in('status', ['confirmed', 'partial', 'completed']);

    const agencyResMap: Record<string, Record<string, number>> = {};
    for (const r of reservations || []) {
      if (!agencyResMap[r.trip_id]) agencyResMap[r.trip_id] = {};
      agencyResMap[r.trip_id][r.agency_id] = (agencyResMap[r.trip_id][r.agency_id] || 0) + 1;
    }

    // Agency names for trip_agencies
    const allAgencyIds = [...new Set(
      trips.flatMap((t: any) => (t.trip_agencies || []).map((ta: any) => ta.agency_id))
    )];
    const { data: agencyNames } = await supabaseAdmin
      .from('agencies')
      .select('id, name')
      .in('id', allAgencyIds.length ? allAgencyIds : ['none']);
    const agencyNameMap = new Map((agencyNames || []).map(a => [a.id, a.name]));

    const data = trips.map((trip: any) => {
      const route = trip.routes;
      const stats = seatMap[trip.id] || { total: 0, available: 0, reserved: 0, locked: 0, blocked: 0 };
      const ta = trip.trip_agencies || [];

      return {
        id: trip.id,
        route_id: trip.route_id,
        route: { origin: route?.origin || '', destination: route?.destination || '' },
        departure_time: trip.departure_time,
        vehicle: { type: trip.vehicle_type, capacity: trip.capacity },
        status: trip.status,
        postponed_from: trip.postponed_from,
        seats: seatsByTrip[trip.id] || [],
        occupancy: {
          total: stats.total,
          available: stats.available,
          reserved: stats.reserved,
          locked: stats.locked,
          blocked: stats.blocked,
          boarded: boardedPerTrip[trip.id] || 0,
        },
        agencies: ta.map((taItem: any) => ({
          id: taItem.agency_id,
          name: agencyNameMap.get(taItem.agency_id) || '',
          reservation_count: agencyResMap[trip.id]?.[taItem.agency_id] || 0,
        })),
        trip_agencies: ta.map((taItem: any) => ({ agency_id: taItem.agency_id })),
      };
    });

    return { data, pagination: { page, limit, total: total || 0, totalPages } };
  }

  async getTrip(id: string) {
    await this.autoCompleteExpiredTrips();
    const { data, error } = await supabaseAdmin
      .from('trips')
      .select('*, routes(*), trip_agencies(*)')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundError('Trip not found');

    // Get agency names for trip_agencies
    const taAgencyIds = ((data as any).trip_agencies || []).map((ta: any) => ta.agency_id);
    const { data: agencies } = await supabaseAdmin
      .from('agencies')
      .select('id, name')
      .in('id', taAgencyIds.length ? taAgencyIds : ['none']);

    const agencyNameMap = new Map((agencies || []).map(a => [a.id, a.name]));

    // Get seats with status
    const { data: seats } = await supabaseAdmin
      .from('seats')
      .select('*')
      .eq('trip_id', id)
      .order('seat_code');

    // Get reservations for this trip with passenger counts
    const { data: reservations } = await supabaseAdmin
      .from('reservations')
      .select('id, agency_id, booker_name, booker_document, booker_phone, status, qr_code, created_at')
      .eq('trip_id', id);

    const resIds = (reservations || []).map(r => r.id);
    let passengers: any[] = [];
    if (resIds.length > 0) {
      const { data: pData } = await supabaseAdmin
        .from('reservation_passengers')
        .select('*, seats(seat_code)')
        .in('reservation_id', resIds);
      passengers = pData || [];
    }

    return {
      ...data,
      routes: (data as any).routes,
      trip_agencies: ((data as any).trip_agencies || []).map((ta: any) => ({
        ...ta,
        agency_name: agencyNameMap.get(ta.agency_id) || '',
      })),
      seats: seats || [],
      reservations: (reservations || []).map(r => ({
        ...r,
        passengers: passengers.filter(p => p.reservation_id === r.id),
      })),
    };
  }

  async updateTrip(
    id: string,
    routeId: string,
    departureTime: string,
    vehicleType: 'bus' | 'kia',
    agencyIds: string[],
  ) {
    if (agencyIds.length === 0) {
      throw new ValidationError('At least one agency is required');
    }

    const config = this.VEHICLE_CONFIG[vehicleType];
    const capacity = config.capacity;

    const { data: existing } = await supabaseAdmin
      .from('trips')
      .select('capacity, departure_time, status')
      .eq('id', id)
      .single();

    if (!existing) throw new NotFoundError('Trip not found');
    if (existing.status === 'completed' || existing.status === 'cancelled') {
      throw new ValidationError('Cannot modify a completed or cancelled trip');
    }

    const updateFields: Record<string, any> = {
      route_id: routeId,
      departure_time: toUTC(departureTime),
      capacity,
      vehicle_type: vehicleType,
    };

    const { error: tripError } = await supabaseAdmin
      .from('trips')
      .update(updateFields)
      .eq('id', id);

    if (tripError) throw new ValidationError(tripError.message);

    // Adjust seats if capacity changed
    const oldCapacity = existing.capacity;
    if (capacity > oldCapacity) {
      const newSeats = Array.from({ length: capacity - oldCapacity }, (_, i) => ({
        trip_id: id,
        seat_code: `A${oldCapacity + i + 1}`,
        status: 'available' as const,
      }));
      await supabaseAdmin.from('seats').insert(newSeats);
    } else if (capacity < oldCapacity) {
      const excessCodes = Array.from({ length: oldCapacity - capacity }, (_, i) => `A${capacity + i + 1}`);
      const { data: reserved } = await supabaseAdmin
        .from('seats')
        .select('seat_code')
        .eq('trip_id', id)
        .in('seat_code', excessCodes)
        .neq('status', 'available');
      if (reserved && reserved.length > 0) {
        throw new ValidationError(`Cannot reduce capacity: seats ${reserved.map(s => s.seat_code).join(', ')} are already reserved`);
      }
      await supabaseAdmin.from('seats').delete().eq('trip_id', id).in('seat_code', excessCodes);
    }

    // Get current trip_agencies for this trip
    const { data: currentTAs } = await supabaseAdmin
      .from('trip_agencies')
      .select('agency_id')
      .eq('trip_id', id);

    const currentAgencyIds = (currentTAs || []).map(ta => ta.agency_id);

    // Remove agencies no longer selected
    const removedAgencies = currentAgencyIds.filter(aid => !agencyIds.includes(aid));
    if (removedAgencies.length > 0) {
      await supabaseAdmin.from('trip_agencies').delete()
        .eq('trip_id', id)
        .in('agency_id', removedAgencies);
    }

    // Add newly selected agencies
    const newAgencies = agencyIds.filter(aid => !currentAgencyIds.includes(aid));
    if (newAgencies.length > 0) {
      const taRows = newAgencies.map(agencyId => ({
        trip_id: id,
        agency_id: agencyId,
      }));
      await supabaseAdmin.from('trip_agencies').insert(taRows);
    }

    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('*, routes(origin, destination), trip_agencies(*)')
      .eq('id', id)
      .single();

    return trip;
  }

  async deleteTrip(id: string) {
    await supabaseAdmin.from('trip_agencies').delete().eq('trip_id', id);
    await supabaseAdmin.from('seats').delete().eq('trip_id', id);
    const { error } = await supabaseAdmin.from('trips').delete().eq('id', id);
    if (error) throw new ValidationError(error.message);
  }

  async updateTripStatus(id: string, status: 'completed' | 'cancelled') {
    const { data: trip, error: fetchError } = await supabaseAdmin
      .from('trips')
      .select('departure_time, status')
      .eq('id', id)
      .single();

    if (fetchError || !trip) throw new NotFoundError('Trip not found');
    if (trip.status !== 'active') throw new ValidationError('Trip is not active');

    const now = new Date();
    const departure = new Date(trip.departure_time);

    if (status === 'completed') {
      if (now < departure) {
        throw new ForbiddenError('Cannot complete a trip before its departure time');
      }
    } else if (status === 'cancelled') {
      if (now >= departure) {
        throw new ForbiddenError('Cannot cancel a trip after its departure time');
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('trips')
      .update({ status })
      .eq('id', id);

    if (updateError) throw new ValidationError(updateError.message);
    return { id, status };
  }

  // ---- Dashboard KPIs ----
  async getDashboard() {
    const { count: totalAgencies } = await supabaseAdmin
      .from('agencies')
      .select('*', { count: 'exact', head: true });

    const { count: activeAgencies } = await supabaseAdmin
      .from('agencies')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    const { count: totalTrips } = await supabaseAdmin
      .from('trips')
      .select('*', { count: 'exact', head: true });

    const { count: activeTrips } = await supabaseAdmin
      .from('trips')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    const { count: totalRoutes } = await supabaseAdmin
      .from('routes')
      .select('*', { count: 'exact', head: true });

    const { count: totalReservations } = await supabaseAdmin
      .from('reservations')
      .select('*', { count: 'exact', head: true });

    const { count: todayReservations } = await supabaseAdmin
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', new Date().toISOString().slice(0, 10));

    // Pending boarding: reservation_passengers not boarded from confirmed/partial reservations
    const { data: pendingData } = await supabaseAdmin
      .from('reservation_passengers')
      .select('id', { count: 'exact' })
      .eq('boarded', false);
    const pendingBoarding = pendingData?.length ?? 0;

    // Upcoming trips (next 5 active trips with reservation count)
    const { data: upcomingTrips } = await supabaseAdmin
      .from('trips')
      .select('id, departure_time, routes(origin, destination), capacity')
      .eq('status', 'active')
      .gte('departure_time', new Date().toISOString())
      .order('departure_time')
      .limit(5);

    let upcoming: any[] = [];
    if (upcomingTrips && upcomingTrips.length > 0) {
      const tripIds = upcomingTrips.map(t => t.id);
      const { data: reservationCounts } = await supabaseAdmin
        .from('reservations')
        .select('trip_id')
        .in('trip_id', tripIds)
        .in('status', ['confirmed', 'partial', 'completed', 'boarded']);

      const countMap: Record<string, number> = {};
      for (const r of reservationCounts || []) {
        countMap[r.trip_id] = (countMap[r.trip_id] || 0) + 1;
      }

      const { data: seatCounts } = await supabaseAdmin
        .from('seats')
        .select('trip_id, status')
        .in('trip_id', tripIds);

      const seatMap: Record<string, { total: number; available: number }> = {};
      for (const s of seatCounts || []) {
        if (!seatMap[s.trip_id]) seatMap[s.trip_id] = { total: 0, available: 0 };
        seatMap[s.trip_id].total++;
        if (s.status === 'available') seatMap[s.trip_id].available++;
      }

      const now = new Date();
      upcoming = upcomingTrips.map(t => {
        const tripId = t.id;
        const seats = seatMap[tripId] || { total: t.capacity || 0, available: 0 };
        const diffMs = new Date(t.departure_time).getTime() - now.getTime();
        const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        return {
          id: tripId,
          departure_time: t.departure_time,
          route: (t as any).routes,
          capacity: seats.total,
          available_seats: seats.available,
          reservation_count: countMap[tripId] || 0,
          days_until_departure: daysUntil,
        };
      });
    }

    // Recent activity (last 10): trips created + reservations + boardings
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: recentTrips }, { data: recentReservations }, { data: recentBoardings }] = await Promise.all([
      supabaseAdmin
        .from('trips')
        .select('id, created_at, routes(origin, destination)')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(10),
      supabaseAdmin
        .from('reservations')
        .select('id, created_at, booker_name, trips!inner(routes(origin, destination))')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(10),
      supabaseAdmin
        .from('boarding_logs')
        .select(`
          id, created_at, action, reservation_passenger_id, scanned_by_agency_id,
          reservations!reservation_id(
            trip_id,
            trips(departure_time, routes(origin, destination))
          )
        `)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const passengerIds = (recentBoardings ?? []).map((b: any) => b.reservation_passenger_id).filter(Boolean);
    const agencyIds = (recentBoardings ?? []).map((b: any) => b.scanned_by_agency_id).filter(Boolean);
    const [{ data: passengers }, { data: agencies }] = await Promise.all([
      passengerIds.length > 0
        ? supabaseAdmin.from('reservation_passengers').select('id, name').in('id', passengerIds)
        : Promise.resolve({ data: [] }),
      agencyIds.length > 0
        ? supabaseAdmin.from('agencies').select('id, name').in('id', agencyIds)
        : Promise.resolve({ data: [] }),
    ]);
    const passengerNames = new Map((passengers ?? []).map((p: any) => [p.id, p.name]));
    const agencyNames = new Map((agencies ?? []).map((a: any) => [a.id, a.name]));

    const activity: any[] = [];
    for (const t of recentTrips || []) {
      const route = (t as any).routes;
      activity.push({
        type: 'trip_created',
        label: `Viaje creado: ${route?.origin || '?'} → ${route?.destination || '?'}`,
        timestamp: t.created_at,
      });
    }
    for (const r of recentReservations || []) {
      const trip = (r as any).trips;
      const route = trip?.routes;
      activity.push({
        type: 'reservation_created',
        label: `Reserva: ${r.booker_name} — ${route?.origin || '?'} → ${route?.destination || '?'}`,
        timestamp: r.created_at,
      });
    }
    for (const b of recentBoardings || []) {
      const res = (b as any).reservations;
      const trip = res?.trips;
      const route = trip?.routes;
      const passengerName = passengerNames.get((b as any).reservation_passenger_id) || '';
      const agencyName = agencyNames.get((b as any).scanned_by_agency_id) || null;

      if (b.action === 'board') {
        let label = 'Abordaje confirmado';
        if (passengerName) label += ` — ${passengerName}`;
        activity.push({
          type: 'boarding',
          label,
          description: `${route?.origin || '?'} → ${route?.destination || '?'}`,
          actor: agencyName,
          timestamp: b.created_at,
        });
      } else if (b.action === 'unboard') {
        let label = 'Abordaje revertido';
        if (passengerName) label += ` — ${passengerName}`;
        activity.push({
          type: 'boarding',
          label,
          description: `${route?.origin || '?'} → ${route?.destination || '?'}`,
          actor: agencyName,
          timestamp: b.created_at,
        });
      } else {
        activity.push({
          type: 'boarding',
          label: `Abordaje ${b.action}`,
          timestamp: b.created_at,
        });
      }
    }

    activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const recentActivity = activity.slice(0, 10);

    // Reservations by month (current month)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const daysInMonth = monthEnd.getDate();

    const { data: reservationsByDate } = await supabaseAdmin
      .from('reservations')
      .select('created_at')
      .gte('created_at', monthStart.toISOString())
      .lte('created_at', monthEnd.toISOString())
      .order('created_at');

    const dateMap: Record<string, number> = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(now.getFullYear(), now.getMonth(), d);
      dateMap[dt.toISOString().slice(0, 10)] = 0;
    }
    for (const r of reservationsByDate || []) {
      const day = r.created_at.slice(0, 10);
      if (dateMap[day] !== undefined) dateMap[day]++;
    }
    const reservations_by_date = Object.entries(dateMap).map(([date, count]) => ({ date, count }));

    // Occupancy by trip (last 10 active/completed trips)
    const { data: recentTripsForOccupancy } = await supabaseAdmin
      .from('trips')
      .select('id, capacity, departure_time, routes(origin, destination)')
      .in('status', ['active', 'completed'])
      .order('departure_time', { ascending: false })
      .limit(10);

    const occupancyData: any[] = [];
    if (recentTripsForOccupancy && recentTripsForOccupancy.length > 0) {
      const tripIds = recentTripsForOccupancy.map(t => t.id);
      const { data: allSeats } = await supabaseAdmin
        .from('seats')
        .select('trip_id, status')
        .in('trip_id', tripIds);

      const tripSeatMap: Record<string, { total: number; reserved: number }> = {};
      for (const t of tripIds) {
        tripSeatMap[t] = { total: 0, reserved: 0 };
      }
      for (const s of allSeats || []) {
        if (tripSeatMap[s.trip_id]) {
          tripSeatMap[s.trip_id].total++;
          if (s.status !== 'available') tripSeatMap[s.trip_id].reserved++;
        }
      }

      for (const t of recentTripsForOccupancy) {
        const stats = tripSeatMap[t.id] || { total: t.capacity || 0, reserved: 0 };
        const route = (t as any).routes;
        occupancyData.push({
          trip_id: t.id,
          label: `${route?.origin || '?'} → ${route?.destination || '?'}`,
          departure: t.departure_time,
          total: stats.total,
          reserved: stats.reserved,
          occupancy_pct: stats.total > 0 ? Math.round((stats.reserved / stats.total) * 100) : 0,
        });
      }
    }

    return {
      total_agencies: totalAgencies || 0,
      active_agencies: activeAgencies || 0,
      total_trips: totalTrips || 0,
      active_trips: activeTrips || 0,
      total_routes: totalRoutes || 0,
      total_reservations: totalReservations || 0,
      today_reservations: todayReservations || 0,
      pending_boarding_passengers: pendingBoarding,
      upcoming_trips: upcoming,
      recent_activity: recentActivity,
      reservations_by_date,
      occupancy_by_trip: occupancyData,
    };
  }
}

export const superadminService = new SuperadminService();
