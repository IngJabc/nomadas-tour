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

    if (error) throw new ValidationError(error.message);

    const tripIds = (trips || []).map((t: any) => t.id);
    const { data: allSeats } = await supabaseAdmin
      .from('seats')
      .select('trip_id, status')
      .in('trip_id', tripIds);

    const availableMap: Record<string, number> = {};
    for (const seat of allSeats || []) {
      if (seat.status === 'available') {
        availableMap[seat.trip_id] = (availableMap[seat.trip_id] || 0) + 1;
      }
    }

    return (trips || []).map((t: any) => ({
      ...t,
      available_seats: availableMap[t.id] ?? 0,
    }));
  }

  async getTripWithSeats(tripId: string) {
    const { data: trip, error: tripError } = await supabaseAdmin
      .from('trips')
      .select('*, routes(origin, destination)')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) throw new NotFoundError('Trip not found');

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

  async getAvailableAgencies(tripId: string) {
    const { data: allocations, error } = await supabaseAdmin
      .from('trip_agency_allocations')
      .select('*, agencies(name)')
      .eq('trip_id', tripId);

    if (error) throw new ValidationError(error.message);

    return (allocations || [])
      .filter(a => a.allocated_seats - a.reserved_seats > 0)
      .map(a => ({
        agency_id: a.agency_id,
        agency_name: (a.agencies as any)?.name || 'Unknown',
        available: a.allocated_seats - a.reserved_seats,
      }));
  }

  async createReservation(
    tripId: string,
    customerName: string,
    passengerCedula: string,
    phone: string | null,
    seatCodes: string[],
    userId: string | null,
  ) {
    const { data: trip, error: tripError } = await supabaseAdmin
      .from('trips')
      .select('*, routes(origin, destination)')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) throw new NotFoundError('Trip not found');

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
      throw new ConflictError(
        `Seats ${unavailableSeats.map(s => s.seat_code).join(', ')} are not available`,
      );
    }

    const { data: allocations, error: allocError } = await supabaseAdmin
      .from('trip_agency_allocations')
      .select('*')
      .eq('trip_id', tripId)
      .order('allocated_seats', { ascending: true });

    if (allocError) throw new ValidationError(allocError.message);

    const needed = seatCodes.length;
    let remaining = needed;
    const assignment: { agency_id: string; seats: number }[] = [];

    for (const alloc of allocations || []) {
      if (remaining <= 0) break;
      const available = alloc.allocated_seats - alloc.reserved_seats;
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      assignment.push({ agency_id: alloc.agency_id, seats: take });
      remaining -= take;
    }

    if (remaining > 0) {
      throw new ConflictError('No agency has enough capacity for these seats');
    }

    const transactionId = crypto.randomUUID();
    const destination = (trip.routes as any)?.destination || '';
    const qrContent = generateQRContent(destination, transactionId);
    const qrDataUrl = await generateQRDataURL(qrContent);

    const reservationRows = seatCodes.map((seatCode, i) => {
      let agencyId: string;
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
        agency_id: agencyId!,
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

    if (insertError) throw new ValidationError(insertError.message);

    const { error: lockError } = await supabaseAdmin
      .from('seats')
      .update({ status: 'reserved', updated_at: new Date().toISOString() })
      .eq('trip_id', tripId)
      .in('seat_code', seatCodes);

    if (lockError) throw new ValidationError(lockError.message);

    for (const a of assignment) {
      const alloc = allocations!.find(al => al.agency_id === a.agency_id);
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

  async cancelReservation(
    tripId: string,
    transactionId: string,
    requestingAgencyId: string | null,
    isSuperadmin: boolean,
  ) {
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

    if (updateError) throw new ValidationError(updateError.message);

    const { error: unlockError } = await supabaseAdmin
      .from('seats')
      .update({ status: 'available', updated_at: new Date().toISOString() })
      .eq('trip_id', tripId)
      .in('seat_code', seatCodes);

    if (unlockError) throw new ValidationError(unlockError.message);

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

  async boardPassenger(tripId: string, qrCode: string, scannedBy: string, agencyId: string | null, isSuperadmin: boolean) {
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

    if (updateError) throw new ValidationError(updateError.message);

    const { data: allPassengers } = await supabaseAdmin
      .from('reservation_passengers')
      .select('boarded')
      .eq('reservation_id', reservation.id);

    const totalCount = allPassengers?.length ?? 0;
    const boardedCount = allPassengers?.filter(p => p.boarded).length ?? 0;

    let newStatus: string;
    if (boardedCount >= totalCount) {
      newStatus = 'completed';
    } else if (boardedCount > 0) {
      newStatus = 'partial';
    } else {
      newStatus = 'confirmed';
    }

    const { error: statusError } = await supabaseAdmin
      .from('reservations')
      .update({ status: newStatus })
      .eq('id', reservation.id);

    if (statusError) throw new ValidationError(statusError.message);

    const { data: seatRows } = await supabaseAdmin
      .from('seats')
      .select('seat_code')
      .in('id', seatIds);

    const seatCodes = (seatRows ?? []).map(s => s.seat_code);

    const { error: seatError } = await supabaseAdmin
      .from('seats')
      .update({ status: 'blocked', updated_at: now })
      .in('id', seatIds);

    if (seatError) throw new ValidationError(seatError.message);

    const { error: logError } = await supabaseAdmin
      .from('boarding_logs')
      .insert({
        reservation_id: reservation.id,
        scanned_by: scannedBy,
        action: 'board',
        seat_ids: seatIds,
      });

    if (logError) throw new ValidationError(logError.message);

    return { boarded: true, seat_codes: seatCodes };
  }

  async createAgencyReservation(
    tripId: string,
    bookerName: string,
    bookerDocument: string,
    bookerPhone: string | null,
    passengers: { seat_id: string; name: string; document: string; phone: string | null }[],
    agencyId: string,
    userId: string,
  ) {
    const { data: trip, error: tripError } = await supabaseAdmin
      .from('trips')
      .select('id, capacity')
      .eq('id', tripId)
      .eq('status', 'active')
      .single();

    if (tripError || !trip) throw new NotFoundError('Trip not found or not active');

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

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      'create_agency_reservation',
      {
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
      },
    );

    if (rpcError) {
      const msg = rpcError.message || '';
      if (msg.includes('ERR_TRIP_NOT_FOUND')) throw new NotFoundError('Trip not found or not active');
      if (msg.includes('ERR_AGENCY_NOT_ASSIGNED')) throw new ForbiddenError('Your agency is not assigned to this trip');
      if (msg.includes('ERR_SEAT_NOT_FOUND')) throw new NotFoundError('One or more seats not found in this trip');
      if (msg.includes('ERR_SEAT_UNAVAILABLE')) throw new ConflictError('One or more seats are no longer available');
      if (msg.includes('ERR_PASSENGER_MISMATCH')) throw new ValidationError('Passenger data mismatch');
      if (msg.includes('ERR_NO_SEATS')) throw new ValidationError('At least one seat is required');
      throw new ValidationError(rpcError.message);
    }

    const reservationId = (rpcResult as any)?.reservation_id;
    if (!reservationId) throw new ValidationError('Failed to create reservation');

    const qrCodeText = (rpcResult as any).qr_code as string;
    const qrDataUrl = await generateQRDataURL(qrCodeText);

    const { data: reservation } = await supabaseAdmin
      .from('reservations')
      .select('*, reservation_passengers(*, seats(seat_code))')
      .eq('id', reservationId)
      .single();

    if (!reservation) throw new NotFoundError('Reservation not found after creation');

    return {
      reservation,
      passengers: (reservation as any).reservation_passengers || [],
      qr_code: qrCodeText,
      qr_data_url: qrDataUrl,
    };
  }

  // Agency-specific queries
  async getAgencyReservations(agencyId: string) {
    const { data, error } = await supabaseAdmin
      .from('reservations')
      .select('*, trips(departure_time, vehicle_type, routes(origin, destination)), reservation_passengers(*, seats(seat_code))')
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false });

    if (error) throw new ValidationError(error.message);
    return data;
  }

  async getAgencyReservationById(id: string, agencyId: string) {
    const { data, error } = await supabaseAdmin
      .from('reservations')
      .select('*, trips(departure_time, vehicle_type, routes(origin, destination)), reservation_passengers(*, seats(seat_code))')
      .eq('id', id)
      .eq('agency_id', agencyId)
      .single();

    if (error || !data) throw new NotFoundError('Reservation not found');
    return data;
  }

  async cancelAgencyReservation(id: string, agencyId: string) {
    const { data: reservation, error: findError } = await supabaseAdmin
      .from('reservations')
      .select('*, reservation_passengers(seat_id)')
      .eq('id', id)
      .eq('agency_id', agencyId)
      .single();

    if (findError || !reservation) throw new NotFoundError('Reservation not found');

    if (reservation.status !== 'confirmed') {
      throw new ValidationError('Only confirmed reservations can be cancelled');
    }

    const seatIds = ((reservation as any).reservation_passengers || []).map((p: any) => p.seat_id);

    const { error: updateError } = await supabaseAdmin
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', id);

    if (updateError) throw new ValidationError(updateError.message);

    if (seatIds.length > 0) {
      const { error: unlockError } = await supabaseAdmin
        .from('seats')
        .update({ status: 'available', updated_at: new Date().toISOString() })
        .eq('trip_id', reservation.trip_id)
        .in('id', seatIds);

      if (unlockError) throw new ValidationError(unlockError.message);
    }

    return { cancelled: true, reservation_id: id, freed_seats: seatIds.length };
  }

  // Customer cancel
  async cancelUserReservation(tripId: string, transactionId: string, userId: string) {
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

    if (updateError) throw new ValidationError(updateError.message);

    const { error: unlockError } = await supabaseAdmin
      .from('seats')
      .update({ status: 'available', updated_at: new Date().toISOString() })
      .eq('trip_id', tripId)
      .in('seat_code', seatCodes);

    if (unlockError) throw new ValidationError(unlockError.message);

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
  async getUserReservations(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('reservations')
      .select('*, trips(departure_time, routes(origin, destination))')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new ValidationError(error.message);
    return data;
  }

  // ---------- Scanner / Boarding parcial ----------

  async lookupReservationByQR(qrCode: string, agencyId: string) {
    const { data: reservation, error } = await supabaseAdmin
      .from('reservations')
      .select('id, trip_id, booker_name, status, trips!inner(departure_time, routes(origin, destination))')
      .eq('qr_code', qrCode)
      .eq('agency_id', agencyId)
      .single();

    if (error || !reservation) throw new NotFoundError('Reservation not found');

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
      trip: (reservation as any).trips,
    };
  }

  async boardPassengers(
    qrCode: string,
    seatIds: string[],
    scannedBy: string,
    agencyId: string,
  ) {
    const { data: reservation, error } = await supabaseAdmin
      .from('reservations')
      .select('id, status')
      .eq('qr_code', qrCode)
      .eq('agency_id', agencyId)
      .single();

    if (error || !reservation) throw new NotFoundError('Reservation not found');

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
      throw new ConflictError(
        `Seats ${alreadyBoarded.map(p => p.seat_id).join(', ')} are already boarded`,
      );
    }

    const now = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from('reservation_passengers')
      .update({ boarded: true, boarded_at: now })
      .eq('reservation_id', reservation.id)
      .in('seat_id', seatIds);

    if (updateError) throw new ValidationError(updateError.message);

    const { data: allPassengers } = await supabaseAdmin
      .from('reservation_passengers')
      .select('boarded')
      .eq('reservation_id', reservation.id);

    const totalCount = allPassengers?.length ?? 0;
    const boardedCount = allPassengers?.filter(p => p.boarded).length ?? 0;

    let newStatus: string;
    if (boardedCount >= totalCount) {
      newStatus = 'completed';
    } else if (boardedCount > 0) {
      newStatus = 'partial';
    } else {
      newStatus = 'confirmed';
    }

    const { error: statusError } = await supabaseAdmin
      .from('reservations')
      .update({ status: newStatus })
      .eq('id', reservation.id);

    if (statusError) throw new ValidationError(statusError.message);

    const { error: logError } = await supabaseAdmin
      .from('boarding_logs')
      .insert({
        reservation_id: reservation.id,
        scanned_by: scannedBy,
        action: 'board',
        seat_ids: seatIds,
      });

    if (logError) throw new ValidationError(logError.message);

    return {
      boarded: seatIds.length,
      reservation_status: newStatus,
      total_passengers: totalCount,
      boarded_count: boardedCount,
    };
  }

  // ─── Sprint 13 — Boarding por pasajero individual ─────────────────────────

  async lookupPassengerByQR(qrCode: string, agencyId: string) {
    const { data: reservation, error } = await supabaseAdmin
      .from('reservations')
      .select('id, trip_id, booker_name, booker_document, status, agencies!inner(name)')
      .eq('qr_code', qrCode)
      .single();

    if (error || !reservation) throw new NotFoundError('Reserva no encontrada');
    const tripId = reservation.trip_id;

    const { data: assignment } = await supabaseAdmin
      .from('trip_agencies')
      .select('id')
      .eq('trip_id', tripId)
      .eq('agency_id', agencyId)
      .maybeSingle();

    if (!assignment) throw new ForbiddenError('Tu agencia no está asignada a este viaje');

    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('departure_time, routes(origin, destination)')
      .eq('id', tripId)
      .single();

    const { data: passengers } = await supabaseAdmin
      .from('reservation_passengers')
      .select('id, name, document, seat_id, boarded, boarded_at')
      .eq('reservation_id', reservation.id);

    return {
      reservation_id: reservation.id,
      trip_id: tripId,
      booker_name: reservation.booker_name,
      booker_document: reservation.booker_document,
      reservation_agency_name: (reservation as any).agencies?.name || '',
      departure_time: (trip as any)?.departure_time || null,
      route: (trip as any)?.routes || null,
      passengers: (passengers || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        document: p.document,
        seat_id: p.seat_id,
        boarded: p.boarded,
        boarded_at: p.boarded_at,
      })),
    };
  }

  async toggleBoarding(passengerId: string, boarded: boolean, userId: string, agencyId: string) {
    const { data: passenger, error: pErr } = await supabaseAdmin
      .from('reservation_passengers')
      .select('id, reservation_id, boarded, seat_id, reservations!inner(trip_id, status)')
      .eq('id', passengerId)
      .single();

    if (pErr || !passenger) throw new NotFoundError('Pasajero no encontrado');
    const reservation = passenger as any;
    const tripId = reservation.reservations.trip_id;

    const { data: assignment } = await supabaseAdmin
      .from('trip_agencies')
      .select('id')
      .eq('trip_id', tripId)
      .eq('agency_id', agencyId)
      .maybeSingle();

    if (!assignment) throw new ForbiddenError('Tu agencia no está asignada a este viaje');

    const now = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from('reservation_passengers')
      .update({ boarded, boarded_at: boarded ? now : null })
      .eq('id', passengerId);

    if (updateError) throw new ValidationError(updateError.message);

    const { data: allPassengers } = await supabaseAdmin
      .from('reservation_passengers')
      .select('boarded')
      .eq('reservation_id', reservation.reservation_id);

    const totalCount = allPassengers?.length ?? 0;
    const boardedCount = allPassengers?.filter((p: any) => p.boarded).length ?? 0;

    let newStatus: string;
    if (boardedCount >= totalCount) {
      newStatus = 'completed';
    } else if (boardedCount > 0) {
      newStatus = 'partial';
    } else {
      newStatus = 'confirmed';
    }

    const { error: statusError } = await supabaseAdmin
      .from('reservations')
      .update({ status: newStatus })
      .eq('id', reservation.reservation_id);

    if (statusError) throw new ValidationError(statusError.message);

    const { error: logError } = await supabaseAdmin
      .from('boarding_logs')
      .insert({
        reservation_id: reservation.reservation_id,
        scanned_by: userId,
        scanned_by_agency_id: agencyId,
        reservation_passenger_id: passengerId,
        action: boarded ? 'board' : 'unboard',
        seat_ids: [reservation.seat_id],
      });

    if (logError) throw new ValidationError(logError.message);

    return {
      passenger_id: passengerId,
      boarded,
      boarded_at: boarded ? now : null,
      reservation_status: newStatus,
      boarded_count: boardedCount,
      total_count: totalCount,
    };
  }

  // Superadmin queries
  async getAllReservations(filters?: { agency_id?: string; trip_id?: string; status?: string }) {
    let query = supabaseAdmin
      .from('reservations')
      .select('*, trips(departure_time, routes(origin, destination)), reservation_passengers(*, seats(seat_code))');

    if (filters?.agency_id) query = query.eq('agency_id', filters.agency_id);
    if (filters?.trip_id) query = query.eq('trip_id', filters.trip_id);
    if (filters?.status) query = query.eq('status', filters.status);

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw new ValidationError(error.message);

    // Flatten: create one row per passenger for agency reservations
    const flattened: any[] = [];
    for (const r of data || []) {
      const rAny = r as any;
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
      } else {
        flattened.push(rAny);
      }
    }

    return flattened;
  }

  // ---- Agency Dashboard ----
  async getAgencyDashboard(agencyId: string) {
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

    let upcoming: any[] = [];
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

      const countMap: Record<string, number> = {};
      for (const r of reservationCounts || []) countMap[r.trip_id] = (countMap[r.trip_id] || 0) + 1;

      const seatMap: Record<string, { total: number; available: number }> = {};
      for (const s of seatCounts || []) {
        if (!seatMap[s.trip_id]) seatMap[s.trip_id] = { total: 0, available: 0 };
        seatMap[s.trip_id].total++;
        if (s.status === 'available') seatMap[s.trip_id].available++;
      }

      upcoming = upcomingTrips.map(t => {
        const seats = seatMap[t.id] || { total: t.capacity || 0, available: 0 };
        return {
          id: t.id,
          departure_time: t.departure_time,
          route: (t as any).routes,
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

    // Agency occupancy by trip
    const { data: agencyTrips } = await supabaseAdmin
      .from('trips')
      .select('id, capacity, departure_time, routes(origin, destination), trip_agencies!inner(agency_id)')
      .eq('trip_agencies.agency_id', agencyId)
      .in('status', ['active', 'completed'])
      .order('departure_time', { ascending: false })
      .limit(10);

    const occupancyData: any[] = [];
    if (agencyTrips && agencyTrips.length > 0) {
      const tripIds = agencyTrips.map(t => t.id);
      const { data: allSeats } = await supabaseAdmin
        .from('seats')
        .select('trip_id, status')
        .in('trip_id', tripIds);

      const tripSeatMap: Record<string, { total: number; reserved: number }> = {};
      for (const t of tripIds) tripSeatMap[t] = { total: 0, reserved: 0 };
      for (const s of allSeats || []) {
        if (tripSeatMap[s.trip_id]) {
          tripSeatMap[s.trip_id].total++;
          if (s.status !== 'available') tripSeatMap[s.trip_id].reserved++;
        }
      }

      for (const t of agencyTrips) {
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

    const { data: agencyInfo } = await supabaseAdmin
      .from('agencies')
      .select('name')
      .eq('id', agencyId)
      .single();

    return {
      agency_name: (agencyInfo as any)?.name || 'Agencia',
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
  async getAgencyTrips(agencyId: string) {
    const { data: trips, error } = await supabaseAdmin
      .from('trips')
      .select('*, routes(origin, destination), trip_agencies!inner(agency_id)')
      .eq('trip_agencies.agency_id', agencyId)
      .neq('status', 'completed')
      .order('departure_time');

    if (error) throw new ValidationError(error.message);

    const tripIds = (trips || []).map((t: any) => t.id);
    const { data: allSeats } = await supabaseAdmin
      .from('seats')
      .select('trip_id, status')
      .in('trip_id', tripIds);

    const seatMap: Record<string, { total: number; available: number; reserved: number }> = {};
    for (const tripId of tripIds) {
      seatMap[tripId] = { total: 0, available: 0, reserved: 0 };
    }
    for (const seat of allSeats || []) {
      const s = seatMap[seat.trip_id];
      if (s) {
        s.total++;
        if (seat.status === 'available') s.available++;
        if (seat.status === 'reserved' || seat.status === 'boarded') s.reserved++;
      }
    }

    return (trips || []).map((t: any) => {
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

  async lockSeat(tripId: string, seatId: string, userId: string, agencyId: string) {
    const { data: assignment } = await supabaseAdmin
      .from('trip_agencies')
      .select('id')
      .eq('trip_id', tripId)
      .eq('agency_id', agencyId)
      .maybeSingle();
    if (!assignment) throw new ForbiddenError('Your agency is not assigned to this trip');

    const { data: seat, error: seatError } = await supabaseAdmin
      .from('seats')
      .select('id, status, trip_id')
      .eq('id', seatId)
      .single();
    if (seatError || !seat) throw new NotFoundError('Seat not found');
    if (seat.trip_id !== tripId) throw new ValidationError('Seat does not belong to this trip');
    if (seat.status !== 'available') throw new ConflictError('Seat is not available');

    const { error: updateError } = await supabaseAdmin
      .from('seats')
      .update({
        status: 'locked',
        locked_by: userId,
        locked_at: new Date().toISOString(),
      })
      .eq('id', seatId)
      .eq('status', 'available');

    if (updateError) throw new ConflictError('Seat was locked by another user');
    return { locked: true, seat_id: seatId };
  }

  async unlockSeat(tripId: string, seatId: string, userId: string, agencyId: string) {
    const { data: assignment } = await supabaseAdmin
      .from('trip_agencies')
      .select('id')
      .eq('trip_id', tripId)
      .eq('agency_id', agencyId)
      .maybeSingle();
    if (!assignment) throw new ForbiddenError('Your agency is not assigned to this trip');

    const { data: seat, error: seatError } = await supabaseAdmin
      .from('seats')
      .select('id, status, locked_by, trip_id')
      .eq('id', seatId)
      .single();
    if (seatError || !seat) throw new NotFoundError('Seat not found');
    if (seat.locked_by !== userId) throw new ForbiddenError('Seat is locked by another user');

    await supabaseAdmin
      .from('seats')
      .update({ status: 'available', locked_by: null, locked_at: null })
      .eq('id', seatId);

    return { unlocked: true, seat_id: seatId };
  }

  async unlockAllSeats(tripId: string, userId: string, agencyId: string) {
    const { data: assignment } = await supabaseAdmin
      .from('trip_agencies')
      .select('id')
      .eq('trip_id', tripId)
      .eq('agency_id', agencyId)
      .maybeSingle();
    if (!assignment) throw new ForbiddenError('Your agency is not assigned to this trip');

    const { data, error } = await supabaseAdmin
      .from('seats')
      .update({ status: 'available', locked_by: null, locked_at: null })
      .eq('trip_id', tripId)
      .eq('status', 'locked')
      .eq('locked_by', userId)
      .select();

    if (error) throw new ValidationError(error.message);
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

    if (error) throw new ValidationError(error.message);
    return { released: (data || []).length };
  }
}

export const reservationService = new ReservationService();
