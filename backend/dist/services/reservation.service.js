import { supabaseAdmin } from '../config/database.js';
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from '../errors/index.js';
import { generateQRContent, generateQRDataURL } from '../utils/qr.js';
export class ReservationService {
    async listActiveTrips() {
        const { data: trips, error } = await supabaseAdmin
            .from('trips')
            .select('*, routes(origin, destination)')
            .eq('status', 'active')
            .order('departure_time');
        if (error)
            throw new ValidationError(error.message);
        const tripIds = (trips || []).map((t) => t.id);
        const { data: allSeats } = await supabaseAdmin
            .from('seats')
            .select('trip_id, status')
            .in('trip_id', tripIds);
        const availableMap = {};
        for (const seat of allSeats || []) {
            if (seat.status === 'available') {
                availableMap[seat.trip_id] = (availableMap[seat.trip_id] || 0) + 1;
            }
        }
        return (trips || []).map((t) => ({
            ...t,
            available_seats: availableMap[t.id] ?? 0,
        }));
    }
    async getTripWithSeats(tripId) {
        const { data: trip, error: tripError } = await supabaseAdmin
            .from('trips')
            .select('*, routes(origin, destination)')
            .eq('id', tripId)
            .single();
        if (tripError || !trip)
            throw new NotFoundError('Trip not found');
        const { data: seats } = await supabaseAdmin
            .from('seats')
            .select('*')
            .eq('trip_id', tripId)
            .order('seat_code');
        const { data: allocations } = await supabaseAdmin
            .from('trip_agency_allocations')
            .select('*')
            .eq('trip_id', tripId);
        return { ...trip, seats: seats || [], allocations: allocations || [] };
    }
    async getAvailableAgencies(tripId) {
        const { data: allocations, error } = await supabaseAdmin
            .from('trip_agency_allocations')
            .select('*, agencies(name)')
            .eq('trip_id', tripId);
        if (error)
            throw new ValidationError(error.message);
        return (allocations || [])
            .filter(a => a.allocated_seats - a.reserved_seats > 0)
            .map(a => ({
            agency_id: a.agency_id,
            agency_name: a.agencies?.name || 'Unknown',
            available: a.allocated_seats - a.reserved_seats,
        }));
    }
    async createReservation(tripId, customerName, passengerCedula, phone, seatCodes, userId) {
        const { data: trip, error: tripError } = await supabaseAdmin
            .from('trips')
            .select('*, routes(origin, destination)')
            .eq('id', tripId)
            .single();
        if (tripError || !trip)
            throw new NotFoundError('Trip not found');
        const { data: seats } = await supabaseAdmin
            .from('seats')
            .select('*')
            .eq('trip_id', tripId)
            .in('seat_code', seatCodes);
        if (!seats || seats.length !== seatCodes.length) {
            throw new NotFoundError('One or more seats not found');
        }
        const unavailableSeats = seats.filter(s => s.status !== 'available');
        if (unavailableSeats.length > 0) {
            throw new ConflictError(`Seats ${unavailableSeats.map(s => s.seat_code).join(', ')} are not available`);
        }
        const { data: allocations, error: allocError } = await supabaseAdmin
            .from('trip_agency_allocations')
            .select('*')
            .eq('trip_id', tripId)
            .order('allocated_seats', { ascending: true });
        if (allocError)
            throw new ValidationError(allocError.message);
        const needed = seatCodes.length;
        let remaining = needed;
        const assignment = [];
        for (const alloc of allocations || []) {
            if (remaining <= 0)
                break;
            const available = alloc.allocated_seats - alloc.reserved_seats;
            if (available <= 0)
                continue;
            const take = Math.min(available, remaining);
            assignment.push({ agency_id: alloc.agency_id, seats: take });
            remaining -= take;
        }
        if (remaining > 0) {
            throw new ConflictError('No agency has enough capacity for these seats');
        }
        const transactionId = crypto.randomUUID();
        const destination = trip.routes?.destination || '';
        const qrContent = generateQRContent(destination, transactionId);
        const qrDataUrl = await generateQRDataURL(qrContent);
        const reservationRows = seatCodes.map((seatCode, i) => {
            let agencyId;
            let seatIndex = 0;
            for (const a of assignment) {
                if (i < seatIndex + a.seats) {
                    agencyId = a.agency_id;
                    break;
                }
                seatIndex += a.seats;
            }
            return {
                trip_id: tripId,
                agency_id: agencyId,
                user_id: userId,
                transaction_id: transactionId,
                customer_name: customerName,
                passenger_cedula: passengerCedula,
                phone,
                seat_code: seatCode,
                status: 'confirmed',
                qr_code: qrContent,
            };
        });
        const { error: insertError } = await supabaseAdmin
            .from('reservations')
            .insert(reservationRows);
        if (insertError)
            throw new ValidationError(insertError.message);
        const { error: lockError } = await supabaseAdmin
            .from('seats')
            .update({ status: 'reserved', updated_at: new Date().toISOString() })
            .eq('trip_id', tripId)
            .in('seat_code', seatCodes);
        if (lockError)
            throw new ValidationError(lockError.message);
        for (const a of assignment) {
            const alloc = allocations.find(al => al.agency_id === a.agency_id);
            if (alloc) {
                await supabaseAdmin
                    .from('trip_agency_allocations')
                    .update({ reserved_seats: alloc.reserved_seats + a.seats })
                    .eq('id', alloc.id);
            }
        }
        return {
            transaction_id: transactionId,
            qr_code: qrContent,
            qr_data_url: qrDataUrl,
            reservations: reservationRows,
            total: 0,
        };
    }
    async cancelReservation(tripId, transactionId, requestingAgencyId, isSuperadmin) {
        let query = supabaseAdmin
            .from('reservations')
            .select('*')
            .eq('transaction_id', transactionId);
        if (!isSuperadmin && requestingAgencyId) {
            query = query.eq('agency_id', requestingAgencyId);
        }
        const { data: reservations, error: findError } = await query;
        if (findError || !reservations || reservations.length === 0) {
            throw new NotFoundError('Reservations not found');
        }
        const seatCodes = reservations.map(r => r.seat_code);
        const { error: updateError } = await supabaseAdmin
            .from('reservations')
            .update({ status: 'cancelled' })
            .eq('transaction_id', transactionId);
        if (updateError)
            throw new ValidationError(updateError.message);
        const { error: unlockError } = await supabaseAdmin
            .from('seats')
            .update({ status: 'available', updated_at: new Date().toISOString() })
            .eq('trip_id', tripId)
            .in('seat_code', seatCodes);
        if (unlockError)
            throw new ValidationError(unlockError.message);
        for (const res of reservations) {
            const { data: alloc } = await supabaseAdmin
                .from('trip_agency_allocations')
                .select('*')
                .eq('trip_id', tripId)
                .eq('agency_id', res.agency_id)
                .single();
            if (alloc) {
                await supabaseAdmin
                    .from('trip_agency_allocations')
                    .update({ reserved_seats: Math.max(0, alloc.reserved_seats - 1) })
                    .eq('id', alloc.id);
            }
        }
        return { cancelled: true, seat_codes: seatCodes };
    }
    async boardPassenger(tripId, qrCode, scannedBy, agencyId, isSuperadmin) {
        let query = supabaseAdmin
            .from('reservations')
            .select('id')
            .eq('qr_code', qrCode)
            .eq('trip_id', tripId)
            .in('status', ['confirmed', 'partial']);
        if (!isSuperadmin && agencyId) {
            query = query.eq('agency_id', agencyId);
        }
        const { data: reservations, error } = await query;
        if (error || !reservations || reservations.length === 0) {
            throw new NotFoundError('No confirmed reservations found with this QR code');
        }
        const reservation = reservations[0];
        const { data: passengers } = await supabaseAdmin
            .from('reservation_passengers')
            .select('id, seat_id, boarded')
            .eq('reservation_id', reservation.id);
        if (!passengers || passengers.length === 0) {
            throw new NotFoundError('No passengers found for this reservation');
        }
        const seatIds = passengers.filter(p => !p.boarded).map(p => p.seat_id);
        if (seatIds.length === 0) {
            throw new ConflictError('All passengers are already boarded');
        }
        const now = new Date().toISOString();
        const { error: updateError } = await supabaseAdmin
            .from('reservation_passengers')
            .update({ boarded: true, boarded_at: now })
            .eq('reservation_id', reservation.id)
            .in('seat_id', seatIds);
        if (updateError)
            throw new ValidationError(updateError.message);
        const { data: allPassengers } = await supabaseAdmin
            .from('reservation_passengers')
            .select('boarded')
            .eq('reservation_id', reservation.id);
        const totalCount = allPassengers?.length ?? 0;
        const boardedCount = allPassengers?.filter(p => p.boarded).length ?? 0;
        let newStatus;
        if (boardedCount >= totalCount) {
            newStatus = 'completed';
        }
        else if (boardedCount > 0) {
            newStatus = 'partial';
        }
        else {
            newStatus = 'confirmed';
        }
        const { error: statusError } = await supabaseAdmin
            .from('reservations')
            .update({ status: newStatus })
            .eq('id', reservation.id);
        if (statusError)
            throw new ValidationError(statusError.message);
        const { data: seatRows } = await supabaseAdmin
            .from('seats')
            .select('seat_code')
            .in('id', seatIds);
        const seatCodes = (seatRows ?? []).map(s => s.seat_code);
        const { error: seatError } = await supabaseAdmin
            .from('seats')
            .update({ status: 'blocked', updated_at: now })
            .in('id', seatIds);
        if (seatError)
            throw new ValidationError(seatError.message);
        const { error: logError } = await supabaseAdmin
            .from('boarding_logs')
            .insert({
            reservation_id: reservation.id,
            scanned_by: scannedBy,
            action: 'board',
            seat_ids: seatIds,
        });
        if (logError)
            throw new ValidationError(logError.message);
        return { boarded: true, seat_codes: seatCodes };
    }
    async createAgencyReservation(tripId, bookerName, bookerDocument, bookerPhone, passengers, agencyId, userId) {
        const { data: trip, error: tripError } = await supabaseAdmin
            .from('trips')
            .select('id, capacity')
            .eq('id', tripId)
            .eq('status', 'active')
            .single();
        if (tripError || !trip)
            throw new NotFoundError('Trip not found or not active');
        const { data: allocation, error: allocError } = await supabaseAdmin
            .from('trip_agencies')
            .select('id')
            .eq('trip_id', tripId)
            .eq('agency_id', agencyId)
            .single();
        if (allocError || !allocation) {
            throw new ForbiddenError('Your agency is not assigned to this trip');
        }
        const passengerCount = passengers.length;
        if (passengerCount > trip.capacity) {
            throw new ValidationError('Passenger count exceeds trip capacity');
        }
        const { count: availableCount } = await supabaseAdmin
            .from('seats')
            .select('*', { count: 'exact', head: true })
            .eq('trip_id', tripId)
            .eq('status', 'available');
        const { count: selfLockedCount } = await supabaseAdmin
            .from('seats')
            .select('*', { count: 'exact', head: true })
            .eq('trip_id', tripId)
            .eq('status', 'locked')
            .eq('locked_by', userId);
        const totalAvailable = (availableCount ?? 0) + (selfLockedCount ?? 0);
        if (passengerCount > totalAvailable) {
            throw new ConflictError('Not enough available seats for all passengers');
        }
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('create_agency_reservation', {
            p_trip_id: tripId,
            p_agency_id: agencyId,
            p_created_by: userId,
            p_booker_name: bookerName,
            p_booker_document: bookerDocument,
            p_booker_phone: bookerPhone ?? '',
            p_seat_ids: passengers.map(p => p.seat_id),
            p_passenger_names: passengers.map(p => p.name),
            p_passenger_documents: passengers.map(p => p.document),
            p_passenger_phones: passengers.map(p => p.phone ?? ''),
        });
        if (rpcError) {
            const msg = rpcError.message || '';
            if (msg.includes('ERR_TRIP_NOT_FOUND'))
                throw new NotFoundError('Trip not found or not active');
            if (msg.includes('ERR_AGENCY_NOT_ASSIGNED'))
                throw new ForbiddenError('Your agency is not assigned to this trip');
            if (msg.includes('ERR_SEAT_NOT_FOUND'))
                throw new NotFoundError('One or more seats not found in this trip');
            if (msg.includes('ERR_SEAT_UNAVAILABLE'))
                throw new ConflictError('One or more seats are no longer available');
            if (msg.includes('ERR_PASSENGER_MISMATCH'))
                throw new ValidationError('Passenger data mismatch');
            if (msg.includes('ERR_NO_SEATS'))
                throw new ValidationError('At least one seat is required');
            throw new ValidationError(rpcError.message);
        }
        const reservationId = rpcResult?.reservation_id;
        if (!reservationId)
            throw new ValidationError('Failed to create reservation');
        const qrCodeText = rpcResult.qr_code;
        const qrDataUrl = await generateQRDataURL(qrCodeText);
        const { data: reservation } = await supabaseAdmin
            .from('reservations')
            .select('*, reservation_passengers(*, seats(seat_code))')
            .eq('id', reservationId)
            .single();
        if (!reservation)
            throw new NotFoundError('Reservation not found after creation');
        return {
            reservation,
            passengers: reservation.reservation_passengers || [],
            qr_code: qrCodeText,
            qr_data_url: qrDataUrl,
        };
    }
    // Agency-specific queries
    async getAgencyReservations(agencyId) {
        const { data, error } = await supabaseAdmin
            .from('reservations')
            .select('*, trips(departure_time, vehicle_type, routes(origin, destination)), reservation_passengers(*, seats(seat_code))')
            .eq('agency_id', agencyId)
            .order('created_at', { ascending: false });
        if (error)
            throw new ValidationError(error.message);
        return data;
    }
    async getAgencyReservationById(id, agencyId) {
        const { data, error } = await supabaseAdmin
            .from('reservations')
            .select('*, trips(departure_time, vehicle_type, routes(origin, destination)), reservation_passengers(*, seats(seat_code))')
            .eq('id', id)
            .eq('agency_id', agencyId)
            .single();
        if (error || !data)
            throw new NotFoundError('Reservation not found');
        return data;
    }
    async cancelAgencyReservation(id, agencyId) {
        const { data: reservation, error: findError } = await supabaseAdmin
            .from('reservations')
            .select('*, reservation_passengers(seat_id)')
            .eq('id', id)
            .eq('agency_id', agencyId)
            .single();
        if (findError || !reservation)
            throw new NotFoundError('Reservation not found');
        if (reservation.status !== 'confirmed') {
            throw new ValidationError('Only confirmed reservations can be cancelled');
        }
        const seatIds = (reservation.reservation_passengers || []).map((p) => p.seat_id);
        const { error: updateError } = await supabaseAdmin
            .from('reservations')
            .update({ status: 'cancelled' })
            .eq('id', id);
        if (updateError)
            throw new ValidationError(updateError.message);
        if (seatIds.length > 0) {
            const { error: unlockError } = await supabaseAdmin
                .from('seats')
                .update({ status: 'available', updated_at: new Date().toISOString() })
                .eq('trip_id', reservation.trip_id)
                .in('id', seatIds);
            if (unlockError)
                throw new ValidationError(unlockError.message);
        }
        return { cancelled: true, reservation_id: id, freed_seats: seatIds.length };
    }
    // Customer cancel
    async cancelUserReservation(tripId, transactionId, userId) {
        const { data: reservations, error: findError } = await supabaseAdmin
            .from('reservations')
            .select('*')
            .eq('transaction_id', transactionId)
            .eq('user_id', userId);
        if (findError || !reservations || reservations.length === 0) {
            throw new NotFoundError('Reservations not found');
        }
        const seatCodes = reservations.map(r => r.seat_code);
        const { error: updateError } = await supabaseAdmin
            .from('reservations')
            .update({ status: 'cancelled' })
            .eq('transaction_id', transactionId);
        if (updateError)
            throw new ValidationError(updateError.message);
        const { error: unlockError } = await supabaseAdmin
            .from('seats')
            .update({ status: 'available', updated_at: new Date().toISOString() })
            .eq('trip_id', tripId)
            .in('seat_code', seatCodes);
        if (unlockError)
            throw new ValidationError(unlockError.message);
        for (const res of reservations) {
            const { data: alloc } = await supabaseAdmin
                .from('trip_agency_allocations')
                .select('*')
                .eq('trip_id', tripId)
                .eq('agency_id', res.agency_id)
                .single();
            if (alloc) {
                await supabaseAdmin
                    .from('trip_agency_allocations')
                    .update({ reserved_seats: Math.max(0, alloc.reserved_seats - 1) })
                    .eq('id', alloc.id);
            }
        }
        return { cancelled: true, seat_codes: seatCodes };
    }
    // Customer queries
    async getUserReservations(userId) {
        const { data, error } = await supabaseAdmin
            .from('reservations')
            .select('*, trips(departure_time, routes(origin, destination))')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error)
            throw new ValidationError(error.message);
        return data;
    }
    // ---------- Scanner / Boarding parcial ----------
    async lookupReservationByQR(qrCode, agencyId) {
        const { data: reservation, error } = await supabaseAdmin
            .from('reservations')
            .select('id, trip_id, booker_name, status, trips!inner(departure_time, routes(origin, destination))')
            .eq('qr_code', qrCode)
            .eq('agency_id', agencyId)
            .single();
        if (error || !reservation)
            throw new NotFoundError('Reservation not found');
        const { data: passengers } = await supabaseAdmin
            .from('reservation_passengers')
            .select('id, seat_id, boarded')
            .eq('reservation_id', reservation.id);
        const totalPassengers = passengers?.length ?? 0;
        const boardedCount = passengers?.filter(p => p.boarded).length ?? 0;
        const seatIds = (passengers ?? [])
            .filter(p => !p.boarded)
            .map(p => p.seat_id);
        return {
            reservation_id: reservation.id,
            trip_id: reservation.trip_id,
            booker_name: reservation.booker_name,
            status: reservation.status,
            total_passengers: totalPassengers,
            boarded_count: boardedCount,
            seat_ids: seatIds,
            trip: reservation.trips,
        };
    }
    async boardPassengers(qrCode, seatIds, scannedBy, agencyId) {
        const { data: reservation, error } = await supabaseAdmin
            .from('reservations')
            .select('id, status')
            .eq('qr_code', qrCode)
            .eq('agency_id', agencyId)
            .single();
        if (error || !reservation)
            throw new NotFoundError('Reservation not found');
        const { data: passengers } = await supabaseAdmin
            .from('reservation_passengers')
            .select('id, seat_id, boarded')
            .eq('reservation_id', reservation.id)
            .in('seat_id', seatIds);
        if (!passengers || passengers.length === 0) {
            throw new NotFoundError('No passengers found for the provided seats');
        }
        const alreadyBoarded = passengers.filter(p => p.boarded);
        if (alreadyBoarded.length > 0) {
            throw new ConflictError(`Seats ${alreadyBoarded.map(p => p.seat_id).join(', ')} are already boarded`);
        }
        const now = new Date().toISOString();
        const { error: updateError } = await supabaseAdmin
            .from('reservation_passengers')
            .update({ boarded: true, boarded_at: now })
            .eq('reservation_id', reservation.id)
            .in('seat_id', seatIds);
        if (updateError)
            throw new ValidationError(updateError.message);
        const { data: allPassengers } = await supabaseAdmin
            .from('reservation_passengers')
            .select('boarded')
            .eq('reservation_id', reservation.id);
        const totalCount = allPassengers?.length ?? 0;
        const boardedCount = allPassengers?.filter(p => p.boarded).length ?? 0;
        let newStatus;
        if (boardedCount >= totalCount) {
            newStatus = 'completed';
        }
        else if (boardedCount > 0) {
            newStatus = 'partial';
        }
        else {
            newStatus = 'confirmed';
        }
        const { error: statusError } = await supabaseAdmin
            .from('reservations')
            .update({ status: newStatus })
            .eq('id', reservation.id);
        if (statusError)
            throw new ValidationError(statusError.message);
        const { error: logError } = await supabaseAdmin
            .from('boarding_logs')
            .insert({
            reservation_id: reservation.id,
            scanned_by: scannedBy,
            action: 'board',
            seat_ids: seatIds,
        });
        if (logError)
            throw new ValidationError(logError.message);
        return {
            boarded: seatIds.length,
            reservation_status: newStatus,
            total_passengers: totalCount,
            boarded_count: boardedCount,
        };
    }
    // Superadmin queries
    async getAllReservations(filters) {
        let query = supabaseAdmin
            .from('reservations')
            .select('*, trips(departure_time, routes(origin, destination)), reservation_passengers(*, seats(seat_code))');
        if (filters?.agency_id)
            query = query.eq('agency_id', filters.agency_id);
        if (filters?.trip_id)
            query = query.eq('trip_id', filters.trip_id);
        if (filters?.status)
            query = query.eq('status', filters.status);
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error)
            throw new ValidationError(error.message);
        // Flatten: create one row per passenger for agency reservations
        const flattened = [];
        for (const r of data || []) {
            const rAny = r;
            if (rAny.reservation_passengers && rAny.reservation_passengers.length > 0) {
                for (const p of rAny.reservation_passengers) {
                    flattened.push({
                        ...rAny,
                        customer_name: p.name || rAny.booker_name,
                        passenger_cedula: p.document || '',
                        seat_code: p.seats?.seat_code || '',
                        passenger_status: p.status,
                        reservation_passengers: undefined,
                    });
                }
            }
            else {
                flattened.push(rAny);
            }
        }
        return flattened;
    }
    // ---- Agency Dashboard ----
    async getAgencyDashboard(agencyId) {
        const { count: totalTrips } = await supabaseAdmin
            .from('trip_agencies')
            .select('*', { count: 'exact', head: true })
            .eq('agency_id', agencyId);
        const { count: activeTrips } = await supabaseAdmin
            .from('trip_agencies')
            .select('*, trips!inner(id)', { count: 'exact', head: true })
            .eq('agency_id', agencyId)
            .eq('trips.status', 'active');
        const { count: totalReservations } = await supabaseAdmin
            .from('reservations')
            .select('*', { count: 'exact', head: true })
            .eq('agency_id', agencyId);
        const { count: todayReservations } = await supabaseAdmin
            .from('reservations')
            .select('*', { count: 'exact', head: true })
            .eq('agency_id', agencyId)
            .gte('created_at', new Date().toISOString().slice(0, 10));
        // Pending boarding passengers
        const { data: pendingPassengers } = await supabaseAdmin
            .from('reservation_passengers')
            .select('id, reservations!inner(agency_id)')
            .eq('boarded', false)
            .eq('reservations.agency_id', agencyId);
        const pendingBoarding = pendingPassengers?.length ?? 0;
        // Upcoming trips for this agency
        const { data: upcomingTrips } = await supabaseAdmin
            .from('trips')
            .select('id, departure_time, capacity, routes(origin, destination), trip_agencies!inner(agency_id)')
            .eq('trip_agencies.agency_id', agencyId)
            .eq('status', 'active')
            .gte('departure_time', new Date().toISOString())
            .order('departure_time')
            .limit(5);
        let upcoming = [];
        if (upcomingTrips && upcomingTrips.length > 0) {
            const tripIds = upcomingTrips.map(t => t.id);
            const [{ data: reservationCounts }, { data: seatCounts }] = await Promise.all([
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
            const countMap = {};
            for (const r of reservationCounts || [])
                countMap[r.trip_id] = (countMap[r.trip_id] || 0) + 1;
            const seatMap = {};
            for (const s of seatCounts || []) {
                if (!seatMap[s.trip_id])
                    seatMap[s.trip_id] = { total: 0, available: 0 };
                seatMap[s.trip_id].total++;
                if (s.status === 'available')
                    seatMap[s.trip_id].available++;
            }
            upcoming = upcomingTrips.map(t => {
                const seats = seatMap[t.id] || { total: t.capacity || 0, available: 0 };
                return {
                    id: t.id,
                    departure_time: t.departure_time,
                    route: t.routes,
                    capacity: seats.total,
                    available_seats: seats.available,
                    reservation_count: countMap[t.id] || 0,
                };
            });
        }
        // Recent agency activity
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const [{ data: recentReservations }, { data: recentBoardings }] = await Promise.all([
            supabaseAdmin
                .from('reservations')
                .select('id, created_at, booker_name, trips!inner(routes(origin, destination))')
                .eq('agency_id', agencyId)
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
                label: `Abordaje ${b.action}`,
                timestamp: b.created_at,
            });
        }
        activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const recentActivity = activity.slice(0, 10);
        // Agency occupancy by trip
        const { data: agencyTrips } = await supabaseAdmin
            .from('trips')
            .select('id, capacity, departure_time, routes(origin, destination), trip_agencies!inner(agency_id)')
            .eq('trip_agencies.agency_id', agencyId)
            .in('status', ['active', 'completed'])
            .order('departure_time', { ascending: false })
            .limit(10);
        const occupancyData = [];
        if (agencyTrips && agencyTrips.length > 0) {
            const tripIds = agencyTrips.map(t => t.id);
            const { data: allSeats } = await supabaseAdmin
                .from('seats')
                .select('trip_id, status')
                .in('trip_id', tripIds);
            const tripSeatMap = {};
            for (const t of tripIds)
                tripSeatMap[t] = { total: 0, reserved: 0 };
            for (const s of allSeats || []) {
                if (tripSeatMap[s.trip_id]) {
                    tripSeatMap[s.trip_id].total++;
                    if (s.status !== 'available')
                        tripSeatMap[s.trip_id].reserved++;
                }
            }
            for (const t of agencyTrips) {
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
        const { data: agencyInfo } = await supabaseAdmin
            .from('agencies')
            .select('name')
            .eq('id', agencyId)
            .single();
        return {
            agency_name: agencyInfo?.name || 'Agencia',
            total_trips: totalTrips || 0,
            active_trips: activeTrips || 0,
            total_reservations: totalReservations || 0,
            today_reservations: todayReservations || 0,
            pending_boarding_passengers: pendingBoarding,
            upcoming_trips: upcoming,
            recent_activity: recentActivity,
            occupancy_by_trip: occupancyData,
        };
    }
    // ---- Agency Trips (Sprint 11.1) ----
    async getAgencyTrips(agencyId) {
        const { data: trips, error } = await supabaseAdmin
            .from('trips')
            .select('*, routes(origin, destination), trip_agencies!inner(agency_id)')
            .eq('trip_agencies.agency_id', agencyId)
            .neq('status', 'completed')
            .order('departure_time');
        if (error)
            throw new ValidationError(error.message);
        const tripIds = (trips || []).map((t) => t.id);
        const { data: allSeats } = await supabaseAdmin
            .from('seats')
            .select('trip_id, status')
            .in('trip_id', tripIds);
        const seatMap = {};
        for (const tripId of tripIds) {
            seatMap[tripId] = { total: 0, available: 0, reserved: 0 };
        }
        for (const seat of allSeats || []) {
            const s = seatMap[seat.trip_id];
            if (s) {
                s.total++;
                if (seat.status === 'available')
                    s.available++;
                if (seat.status === 'reserved' || seat.status === 'boarded')
                    s.reserved++;
            }
        }
        return (trips || []).map((t) => {
            const seats = seatMap[t.id] || { total: 0, available: 0, reserved: 0 };
            return {
                id: t.id,
                route: t.routes,
                departure_time: t.departure_time,
                vehicle_type: t.vehicle_type,
                status: t.status,
                total_seats: seats.total,
                available_seats: seats.available,
                reserved_seats: seats.reserved,
            };
        });
    }
    // ─── Seat locking ──────────────────────────────────────────────────────────
    async lockSeat(tripId, seatId, userId, agencyId) {
        const { data: assignment } = await supabaseAdmin
            .from('trip_agencies')
            .select('id')
            .eq('trip_id', tripId)
            .eq('agency_id', agencyId)
            .maybeSingle();
        if (!assignment)
            throw new ForbiddenError('Your agency is not assigned to this trip');
        const { data: seat, error: seatError } = await supabaseAdmin
            .from('seats')
            .select('id, status, trip_id')
            .eq('id', seatId)
            .single();
        if (seatError || !seat)
            throw new NotFoundError('Seat not found');
        if (seat.trip_id !== tripId)
            throw new ValidationError('Seat does not belong to this trip');
        if (seat.status !== 'available')
            throw new ConflictError('Seat is not available');
        const { error: updateError } = await supabaseAdmin
            .from('seats')
            .update({
            status: 'locked',
            locked_by: userId,
            locked_at: new Date().toISOString(),
        })
            .eq('id', seatId)
            .eq('status', 'available');
        if (updateError)
            throw new ConflictError('Seat was locked by another user');
        return { locked: true, seat_id: seatId };
    }
    async unlockSeat(tripId, seatId, userId, agencyId) {
        const { data: assignment } = await supabaseAdmin
            .from('trip_agencies')
            .select('id')
            .eq('trip_id', tripId)
            .eq('agency_id', agencyId)
            .maybeSingle();
        if (!assignment)
            throw new ForbiddenError('Your agency is not assigned to this trip');
        const { data: seat, error: seatError } = await supabaseAdmin
            .from('seats')
            .select('id, status, locked_by, trip_id')
            .eq('id', seatId)
            .single();
        if (seatError || !seat)
            throw new NotFoundError('Seat not found');
        if (seat.locked_by !== userId)
            throw new ForbiddenError('Seat is locked by another user');
        await supabaseAdmin
            .from('seats')
            .update({ status: 'available', locked_by: null, locked_at: null })
            .eq('id', seatId);
        return { unlocked: true, seat_id: seatId };
    }
    async unlockAllSeats(tripId, userId, agencyId) {
        const { data: assignment } = await supabaseAdmin
            .from('trip_agencies')
            .select('id')
            .eq('trip_id', tripId)
            .eq('agency_id', agencyId)
            .maybeSingle();
        if (!assignment)
            throw new ForbiddenError('Your agency is not assigned to this trip');
        const { data, error } = await supabaseAdmin
            .from('seats')
            .update({ status: 'available', locked_by: null, locked_at: null })
            .eq('trip_id', tripId)
            .eq('status', 'locked')
            .eq('locked_by', userId)
            .select();
        if (error)
            throw new ValidationError(error.message);
        return { unlocked: (data || []).length };
    }
    async releaseExpiredLocks() {
        const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data, error } = await supabaseAdmin
            .from('seats')
            .update({ status: 'available', locked_by: null, locked_at: null })
            .eq('status', 'locked')
            .lt('locked_at', cutoff)
            .select();
        if (error)
            throw new ValidationError(error.message);
        return { released: (data || []).length };
    }
}
export const reservationService = new ReservationService();
//# sourceMappingURL=reservation.service.js.map