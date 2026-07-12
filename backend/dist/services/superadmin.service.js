import { supabaseAdmin } from '../config/database.js';
import { generateUniqueSubdomain } from '../utils/subdomain.js';
import { NotFoundError, ValidationError, ForbiddenError } from '../errors/index.js';
import { generateToken } from '../utils/token.js';
export class SuperadminService {
    // ---- Agencies ----
    async listAgencies() {
        const { data, error } = await supabaseAdmin
            .from('agencies')
            .select('*')
            .order('name');
        if (error)
            throw new ValidationError(error.message);
        return data;
    }
    async getAgency(id) {
        const { data, error } = await supabaseAdmin
            .from('agencies')
            .select('*')
            .eq('id', id)
            .single();
        if (error || !data)
            throw new NotFoundError('Agency not found');
        return data;
    }
    async createAgency(name, email, createdBy) {
        const subdomain = await generateUniqueSubdomain(name, supabaseAdmin);
        const { data: agency, error: agencyError } = await supabaseAdmin
            .from('agencies')
            .insert({ name, subdomain, email, status: 'pending' })
            .select()
            .single();
        if (agencyError)
            throw new ValidationError(agencyError.message);
        const token = generateToken();
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        const { error: inviteError } = await supabaseAdmin
            .from('agency_invitations')
            .insert({ token, agency_id: agency.id, email, expires_at: expiresAt });
        if (inviteError)
            throw new ValidationError(inviteError.message);
        return { ...agency, invitation_link: `/accept-invitation?token=${token}` };
    }
    async updateAgency(id, updates) {
        const { data, error } = await supabaseAdmin
            .from('agencies')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error)
            throw new ValidationError(error.message);
        if (!data)
            throw new NotFoundError('Agency not found');
        return data;
    }
    // ---- Routes ----
    async listRoutes() {
        const { data, error } = await supabaseAdmin
            .from('routes')
            .select('*')
            .order('origin');
        if (error)
            throw new ValidationError(error.message);
        return data;
    }
    async createRoute(origin, destination) {
        const { data, error } = await supabaseAdmin
            .from('routes')
            .insert({ origin, destination })
            .select()
            .single();
        if (error)
            throw new ValidationError(error.message);
        return data;
    }
    async updateRoute(id, updates) {
        const { data, error } = await supabaseAdmin
            .from('routes')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error)
            throw new ValidationError(error.message);
        if (!data)
            throw new NotFoundError('Route not found');
        return data;
    }
    async deleteRoute(id) {
        const { error } = await supabaseAdmin
            .from('routes')
            .delete()
            .eq('id', id);
        if (error)
            throw new ValidationError(error.message);
    }
    // ---- Auto-complete expired trips ----
    async autoCompleteExpiredTrips() {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { error } = await supabaseAdmin
            .from('trips')
            .update({ status: 'completed' })
            .eq('status', 'active')
            .lt('departure_time', cutoff);
        if (error)
            throw new ValidationError(error.message);
    }
    // ---- Vehicle config ----
    VEHICLE_CONFIG = {
        bus: {
            capacity: 31,
            seats: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'A22', 'A23', 'A24', 'A25', 'A26', 'A27', 'A28', 'A29', 'A30', 'A31'],
        },
        kia: {
            capacity: 10,
            seats: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'],
        },
    };
    // ---- Trips (atomic: trip + seats + allocations) ----
    async createTrip(routeId, departureTime, vehicleType, agencyIds, createdBy) {
        if (agencyIds.length === 0) {
            throw new ValidationError('At least one agency is required');
        }
        const config = this.VEHICLE_CONFIG[vehicleType];
        const capacity = config.capacity;
        const seatCodes = config.seats;
        const { data: route } = await supabaseAdmin
            .from('routes')
            .select('id')
            .eq('id', routeId)
            .single();
        if (!route)
            throw new NotFoundError('Route not found');
        const { data: trip, error: tripError } = await supabaseAdmin
            .from('trips')
            .insert({
            route_id: routeId,
            departure_time: departureTime,
            capacity,
            vehicle_type: vehicleType,
            created_by: createdBy,
        })
            .select()
            .single();
        if (tripError)
            throw new ValidationError(tripError.message);
        const seatRows = seatCodes.map(seatCode => ({
            trip_id: trip.id,
            seat_code: seatCode,
            status: 'available',
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
    async listTrips() {
        await this.autoCompleteExpiredTrips();
        const { data, error } = await supabaseAdmin
            .from('trips')
            .select('*, routes(origin, destination), trip_agencies(*)')
            .order('departure_time');
        if (error)
            throw new ValidationError(error.message);
        return data;
    }
    async getTrip(id) {
        await this.autoCompleteExpiredTrips();
        const { data, error } = await supabaseAdmin
            .from('trips')
            .select('*, routes(origin, destination), trip_agencies(*)')
            .eq('id', id)
            .single();
        if (error || !data)
            throw new NotFoundError('Trip not found');
        return data;
    }
    async updateTrip(id, routeId, departureTime, vehicleType, agencyIds) {
        if (agencyIds.length === 0) {
            throw new ValidationError('At least one agency is required');
        }
        const config = this.VEHICLE_CONFIG[vehicleType];
        const capacity = config.capacity;
        const { data: existing } = await supabaseAdmin
            .from('trips')
            .select('capacity, departure_time')
            .eq('id', id)
            .single();
        if (!existing)
            throw new NotFoundError('Trip not found');
        const updateFields = {
            route_id: routeId,
            departure_time: departureTime,
            capacity,
            vehicle_type: vehicleType,
        };
        const { error: tripError } = await supabaseAdmin
            .from('trips')
            .update(updateFields)
            .eq('id', id);
        if (tripError)
            throw new ValidationError(tripError.message);
        // Adjust seats if capacity changed
        const oldCapacity = existing.capacity;
        if (capacity > oldCapacity) {
            const newSeats = Array.from({ length: capacity - oldCapacity }, (_, i) => ({
                trip_id: id,
                seat_code: `A${oldCapacity + i + 1}`,
                status: 'available',
            }));
            await supabaseAdmin.from('seats').insert(newSeats);
        }
        else if (capacity < oldCapacity) {
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
    async deleteTrip(id) {
        await supabaseAdmin.from('trip_agencies').delete().eq('trip_id', id);
        await supabaseAdmin.from('seats').delete().eq('trip_id', id);
        const { error } = await supabaseAdmin.from('trips').delete().eq('id', id);
        if (error)
            throw new ValidationError(error.message);
    }
    async updateTripStatus(id, status) {
        const { data: trip, error: fetchError } = await supabaseAdmin
            .from('trips')
            .select('departure_time, status')
            .eq('id', id)
            .single();
        if (fetchError || !trip)
            throw new NotFoundError('Trip not found');
        if (trip.status !== 'active')
            throw new ValidationError('Trip is not active');
        const now = new Date();
        const departure = new Date(trip.departure_time);
        if (status === 'completed') {
            if (now < departure) {
                throw new ForbiddenError('Cannot complete a trip before its departure time');
            }
        }
        else if (status === 'cancelled') {
            if (now >= departure) {
                throw new ForbiddenError('Cannot cancel a trip after its departure time');
            }
        }
        const { error: updateError } = await supabaseAdmin
            .from('trips')
            .update({ status })
            .eq('id', id);
        if (updateError)
            throw new ValidationError(updateError.message);
        return { id, status };
    }
    // ---- Invitations ----
    async listInvitations() {
        const { data, error } = await supabaseAdmin
            .from('agency_invitations')
            .select('*')
            .order('expires_at', { ascending: false });
        if (error)
            throw new ValidationError(error.message);
        return data;
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
        let upcoming = [];
        if (upcomingTrips && upcomingTrips.length > 0) {
            const tripIds = upcomingTrips.map(t => t.id);
            const { data: reservationCounts } = await supabaseAdmin
                .from('reservations')
                .select('trip_id')
                .in('trip_id', tripIds)
                .in('status', ['confirmed', 'partial', 'completed', 'boarded']);
            const countMap = {};
            for (const r of reservationCounts || []) {
                countMap[r.trip_id] = (countMap[r.trip_id] || 0) + 1;
            }
            const { data: seatCounts } = await supabaseAdmin
                .from('seats')
                .select('trip_id, status')
                .in('trip_id', tripIds);
            const seatMap = {};
            for (const s of seatCounts || []) {
                if (!seatMap[s.trip_id])
                    seatMap[s.trip_id] = { total: 0, available: 0 };
                seatMap[s.trip_id].total++;
                if (s.status === 'available')
                    seatMap[s.trip_id].available++;
            }
            upcoming = upcomingTrips.map(t => {
                const tripId = t.id;
                const seats = seatMap[tripId] || { total: t.capacity || 0, available: 0 };
                return {
                    id: tripId,
                    departure_time: t.departure_time,
                    route: t.routes,
                    capacity: seats.total,
                    available_seats: seats.available,
                    reservation_count: countMap[tripId] || 0,
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
                .select('id, created_at, action, reservation_id')
                .gte('created_at', thirtyDaysAgo)
                .order('created_at', { ascending: false })
                .limit(10),
        ]);
        const activity = [];
        for (const t of recentTrips || []) {
            const route = t.routes;
            activity.push({
                type: 'trip_created',
                label: `Viaje creado: ${route?.origin || '?'} → ${route?.destination || '?'}`,
                timestamp: t.created_at,
            });
        }
        for (const r of recentReservations || []) {
            const trip = r.trips;
            const route = trip?.routes;
            activity.push({
                type: 'reservation_created',
                label: `Reserva: ${r.booker_name} — ${route?.origin || '?'} → ${route?.destination || '?'}`,
                timestamp: r.created_at,
            });
        }
        for (const b of recentBoardings || []) {
            activity.push({
                type: 'boarding',
                label: `Abordaje ${b.action} — reserva ${b.reservation_id.slice(0, 8)}`,
                timestamp: b.created_at,
            });
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
        const dateMap = {};
        for (let d = 1; d <= daysInMonth; d++) {
            const dt = new Date(now.getFullYear(), now.getMonth(), d);
            dateMap[dt.toISOString().slice(0, 10)] = 0;
        }
        for (const r of reservationsByDate || []) {
            const day = r.created_at.slice(0, 10);
            if (dateMap[day] !== undefined)
                dateMap[day]++;
        }
        const reservations_by_date = Object.entries(dateMap).map(([date, count]) => ({ date, count }));
        // Occupancy by trip (last 10 active/completed trips)
        const { data: recentTripsForOccupancy } = await supabaseAdmin
            .from('trips')
            .select('id, capacity, departure_time, routes(origin, destination)')
            .in('status', ['active', 'completed'])
            .order('departure_time', { ascending: false })
            .limit(10);
        const occupancyData = [];
        if (recentTripsForOccupancy && recentTripsForOccupancy.length > 0) {
            const tripIds = recentTripsForOccupancy.map(t => t.id);
            const { data: allSeats } = await supabaseAdmin
                .from('seats')
                .select('trip_id, status')
                .in('trip_id', tripIds);
            const tripSeatMap = {};
            for (const t of tripIds) {
                tripSeatMap[t] = { total: 0, reserved: 0 };
            }
            for (const s of allSeats || []) {
                if (tripSeatMap[s.trip_id]) {
                    tripSeatMap[s.trip_id].total++;
                    if (s.status !== 'available')
                        tripSeatMap[s.trip_id].reserved++;
                }
            }
            for (const t of recentTripsForOccupancy) {
                const stats = tripSeatMap[t.id] || { total: t.capacity || 0, reserved: 0 };
                const route = t.routes;
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
//# sourceMappingURL=superadmin.service.js.map