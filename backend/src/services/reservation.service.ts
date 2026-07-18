import { supabaseAdmin } from '../config/database.js';
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from '../errors/index.js';
import { generateQRContent, generateQRDataURL } from '../utils/qr.js';
import { sortBySeatCode } from '../utils/sort.js';

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
      passengers: sortBySeatCode((reservation as any).reservation_passengers || []),
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
    if (data) {
      for (const r of data) {
        (r as any).reservation_passengers = sortBySeatCode((r as any).reservation_passengers || []);
      }
    }
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

    let qr_data_url: string | null = null;
    if (data.qr_code) {
      try {
        qr_data_url = await generateQRDataURL(data.qr_code);
      } catch {
        qr_data_url = null;
      }
    }

    return { ...data, qr_data_url, reservation_passengers: sortBySeatCode((data as any).reservation_passengers || []) };
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
      .select('id, name, document, seat_id, boarded, boarded_at, seats(seat_code)')
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
        seat_code: p.seats?.seat_code ?? null,
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

  // Superadmin: paginated reservations list with search and agency info
  async getAllReservations(params: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    agency_id?: string;
    trip_id?: string;
  } = {}) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Resolve search text to matching reservation IDs
    let matchedIds: string[] | null = null;
    if (params.search) {
      const q = params.search;
      const reservationIds = new Set<string>();

      // Search by reservation-level fields
      const { data: byName } = await supabaseAdmin
        .from('reservations')
        .select('id')
        .or(`customer_name.ilike.%${q}%,passenger_cedula.ilike.%${q}%,qr_code.ilike.%${q}%,seat_code.ilike.%${q}%`);
      (byName || []).forEach((r: any) => reservationIds.add(r.id));

      // Search by passenger name/document in reservation_passengers
      const { data: byPassenger } = await supabaseAdmin
        .from('reservation_passengers')
        .select('reservation_id')
        .or(`name.ilike.%${q}%,document.ilike.%${q}%`);
      (byPassenger || []).forEach((p: any) => reservationIds.add(p.reservation_id));

      // Search by agency name
      const { data: matchingAgencies } = await supabaseAdmin
        .from('agencies')
        .select('id')
        .ilike('name', `%${q}%`);
      if (matchingAgencies && matchingAgencies.length > 0) {
        const agencyIds = matchingAgencies.map((a: any) => a.id);
        const { data: byAgency } = await supabaseAdmin
          .from('reservations')
          .select('id')
          .in('agency_id', agencyIds);
        (byAgency || []).forEach((r: any) => reservationIds.add(r.id));
      }

      matchedIds = [...reservationIds];
      if (matchedIds.length === 0) {
        return { data: [], pagination: { page, limit, total: 0, totalPages: 0 } };
      }
    }

    // Build count query
    let countQuery = supabaseAdmin
      .from('reservations')
      .select('*', { count: 'exact', head: true });
    if (params.status) countQuery = countQuery.eq('status', params.status);
    if (params.agency_id) countQuery = countQuery.eq('agency_id', params.agency_id);
    if (params.trip_id) countQuery = countQuery.eq('trip_id', params.trip_id);
    if (matchedIds) countQuery = countQuery.in('id', matchedIds);
    const { count: total } = await countQuery;

    // Build data query
    let dataQuery = supabaseAdmin
      .from('reservations')
      .select('*, trips(departure_time, routes(origin, destination)), agencies(id, name), reservation_passengers(*, seats(seat_code))')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (params.status) dataQuery = dataQuery.eq('status', params.status);
    if (params.agency_id) dataQuery = dataQuery.eq('agency_id', params.agency_id);
    if (params.trip_id) dataQuery = dataQuery.eq('trip_id', params.trip_id);
    if (matchedIds) dataQuery = dataQuery.in('id', matchedIds);

    const { data, error } = await dataQuery;

    if (error) throw new ValidationError(error.message);

    // Sort passengers by seat code within each reservation
    for (const r of data || []) {
      (r as any).reservation_passengers = sortBySeatCode((r as any).reservation_passengers || []);
    }

    // Flatten: one row per passenger for agency reservations
    const flattened: any[] = [];
    for (const r of data || []) {
      const rAny = r as any;
      const agency = rAny.agencies;
      const base = {
        id: rAny.id,
        transaction_id: rAny.transaction_id,
        trip_id: rAny.trip_id,
        agency_id: rAny.agency_id,
        agency_name: agency?.name || null,
        status: rAny.status,
        qr_code: rAny.qr_code,
        created_at: rAny.created_at,
        trips: rAny.trips,
        booker_name: rAny.booker_name,
      };
      if (rAny.reservation_passengers && rAny.reservation_passengers.length > 0) {
        for (const p of rAny.reservation_passengers) {
          flattened.push({
            ...base,
            row_id: `${rAny.id}-${p.id}`,
            passenger_id: p.id,
            customer_name: p.name || rAny.booker_name,
            passenger_cedula: p.document || '',
            seat_code: p.seats?.seat_code || '',
            passenger_status: p.status,
          });
        }
      } else {
        flattened.push({
          ...base,
          row_id: rAny.id,
          passenger_id: null,
          customer_name: rAny.customer_name || rAny.booker_name,
          passenger_cedula: rAny.passenger_cedula || '',
          seat_code: rAny.seat_code || '',
        });
      }
    }

    const totalPages = Math.ceil((total || 0) / limit);
    return { data: flattened, pagination: { page, limit, total: total || 0, totalPages } };
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
      .limit(10);

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

      const now = new Date();
      upcoming = upcomingTrips.map(t => {
        const seats = seatMap[t.id] || { total: t.capacity || 0, available: 0 };
        const diffMs = new Date(t.departure_time).getTime() - now.getTime();
        const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        return {
          id: t.id,
          departure_time: t.departure_time,
          route: (t as any).routes,
          capacity: seats.total,
          available_seats: seats.available,
          reservation_count: countMap[t.id] || 0,
          days_until_departure: daysUntil,
        };
      });
    }

    // Recent agency activity
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Get trip_ids assigned to this agency (for boarding_logs filter)
    const { data: assignedTripRows } = await supabaseAdmin
      .from('trip_agencies')
      .select('trip_id')
      .eq('agency_id', agencyId);
    const assignedTripIds = (assignedTripRows ?? []).map((t: any) => t.trip_id);

    const [{ data: recentReservations }, { data: recentBoardings }, { data: recentAssignments }] = await Promise.all([
      supabaseAdmin
        .from('reservations')
        .select('id, created_at, booker_name, trips!inner(routes(origin, destination))')
        .eq('agency_id', agencyId)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(10),
      assignedTripIds.length > 0
        ? supabaseAdmin
            .from('boarding_logs')
            .select(`
              id, created_at, action, reservation_passenger_id, scanned_by_agency_id,
              reservations!reservation_id(
                trip_id,
                trips(departure_time, routes(origin, destination))
              )
            `)
            .in('reservations.trip_id', assignedTripIds)
            .gte('created_at', thirtyDaysAgo)
            .order('created_at', { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),
      supabaseAdmin
        .from('trip_agencies')
        .select(`
          created_at,
          trips!inner(
            departure_time,
            routes(origin, destination)
          )
        `)
        .eq('agency_id', agencyId)
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
    for (const ta of recentAssignments || []) {
      const trip = (ta as any).trips;
      const route = trip?.routes;
      activity.push({
        type: 'trip_assigned',
        label: `Viaje asignado: ${route?.origin || '?'} → ${route?.destination || '?'}`,
        description: new Date(trip?.departure_time).toLocaleDateString('es-ES', {
          day: 'numeric', month: 'short', year: 'numeric',
        }),
        timestamp: (ta as any).created_at,
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

  // ─── Agency: trip passenger manifest ─────────────────────────────────────

  async getAgencyTripPassengers(tripId: string, agencyId: string) {
    const { data: trip, error: tripError } = await supabaseAdmin
      .from('trips')
      .select('id, departure_time, vehicle_type, status, routes(origin, destination)')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) throw new NotFoundError('Trip not found');

    const { data: assignment } = await supabaseAdmin
      .from('trip_agencies')
      .select('agency_id')
      .eq('trip_id', tripId)
      .eq('agency_id', agencyId)
      .maybeSingle();

    if (!assignment) throw new ForbiddenError('Trip not assigned to this agency');

    const { data: seats } = await supabaseAdmin
      .from('seats')
      .select('id, status')
      .eq('trip_id', tripId);

    const total_seats = (seats || []).length;
    const reserved_seats = (seats || []).filter((s: any) => s.status === 'reserved' || s.status === 'boarded').length;
    const available_seats = (seats || []).filter((s: any) => s.status === 'available').length;

    const { data: reservations } = await supabaseAdmin
      .from('reservations')
      .select('id, booker_name, status, reservation_passengers(id, name, document, phone, boarded, seat_id, seats(seat_code))')
      .eq('trip_id', tripId)
      .eq('agency_id', agencyId)
      .neq('status', 'cancelled');

    const passengers: any[] = [];
    let boarded = 0;

    for (const res of reservations || []) {
      for (const p of (res as any).reservation_passengers || []) {
        if (p.boarded) boarded++;
        passengers.push({
          id: p.id,
          name: p.name,
          document: p.document,
          phone: p.phone,
          seat_code: p.seats?.seat_code ?? '—',
          reservation_id: res.id,
          reservation_status: res.status,
          booker_name: res.booker_name,
          boarded: p.boarded,
        });
      }
    }

    passengers.sort((a: any, b: any) =>
      (a.seat_code || '\uffff').localeCompare(b.seat_code || '\uffff', undefined, { numeric: true })
    );

    return {
      trip: {
        id: trip.id,
        departure_time: trip.departure_time,
        vehicle_type: trip.vehicle_type,
        status: trip.status,
        route: trip.routes,
        total_seats,
        available_seats,
        reserved_seats,
      },
      passengers,
      stats: {
        total: passengers.length,
        reserved: reserved_seats,
        boarded,
      },
    };
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

  // ─── Superadmin: single reservation detail ──────────────────────────────

  async getReservationById(id: string) {
    const { data, error } = await supabaseAdmin
      .from('reservations')
      .select('*, trips(*, routes(*)), agencies(id, name), reservation_passengers(*, seats(seat_code))')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundError('Reservation not found');

    const r = data as any;
    const passengers = r.reservation_passengers || [];

    return {
      id: r.id,
      booker_name: r.booker_name,
      booker_document: r.booker_document,
      qr_code: r.qr_code,
      status: r.status,
      created_at: r.created_at,
      agency_id: r.agency_id,
      trip_id: r.trip_id,
      agencies: r.agencies ?? null,
      trips: r.trips ?? null,
      reservation_passengers: sortBySeatCode(passengers),
    };
  }

  async updateReservationStatus(id: string, status: string) {
    const validStatuses = ['confirmed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new ValidationError(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    const { data: reservation, error: findError } = await supabaseAdmin
      .from('reservations')
      .select('*, reservation_passengers(seat_id)')
      .eq('id', id)
      .single();

    if (findError || !reservation) throw new NotFoundError('Reservation not found');

    if (status === 'confirmed' && reservation.status !== 'cancelled') {
      throw new ValidationError('Only cancelled reservations can be reactivated');
    }

    if (status === 'cancelled' && reservation.status !== 'confirmed') {
      throw new ValidationError('Only confirmed reservations can be cancelled');
    }

    const { error: updateError } = await supabaseAdmin
      .from('reservations')
      .update({ status })
      .eq('id', id);

    if (updateError) throw new ValidationError(updateError.message);

    if (status === 'cancelled') {
      const seatIds = ((reservation as any).reservation_passengers || []).map((p: any) => p.seat_id);
      if (seatIds.length > 0) {
        const { error: unlockError } = await supabaseAdmin
          .from('seats')
          .update({ status: 'available', updated_at: new Date().toISOString() })
          .eq('trip_id', reservation.trip_id)
          .in('id', seatIds);

        if (unlockError) throw new ValidationError(unlockError.message);
      }
    }

    return { id, status };
  }

  // ─── Passenger Explorer Tree ───────────────────────────────────────────
  // New endpoint for /admin/bookings: returns Route → Trip → Passengers tree.
  // No pagination. Each trip appears complete.

  async getPassengerTree(params: {
    status?: string;
    route_id?: string;
    trip_id?: string;
    agency_id?: string;
    date?: string;
    search?: string;
  } = {}) {
    // 1. Resolve trip-level filters (route_id, date) → trip_ids
    let tripFilterIds: string[] | null = null;
    if (params.route_id || params.date) {
      let tripQ = supabaseAdmin.from('trips').select('id');
      if (params.route_id) tripQ = tripQ.eq('route_id', params.route_id);
      if (params.date) {
        tripQ = tripQ
          .gte('departure_time', `${params.date}T00:00:00Z`)
          .lte('departure_time', `${params.date}T23:59:59.999Z`);
      }
      const { data: trips } = await tripQ;
      tripFilterIds = (trips || []).map((t: any) => t.id);
      if (tripFilterIds.length === 0) return [];
    }

    // 2. Resolve search → trip_ids
    let searchTripIds: string[] | null = null;
    if (params.search) {
      searchTripIds = await this._resolveSearchTripIds(params.search);
      if (searchTripIds.length === 0) return [];
    }

    // 3. Intersect trip filters
    let effectiveTripIds: string[] | null = null;
    if (tripFilterIds && searchTripIds) {
      const searchSet = new Set(searchTripIds);
      effectiveTripIds = tripFilterIds.filter((id) => searchSet.has(id));
    } else {
      effectiveTripIds = tripFilterIds || searchTripIds;
    }
    if (params.trip_id) {
      effectiveTripIds = effectiveTripIds
        ? effectiveTripIds.filter((id) => id === params.trip_id)
        : [params.trip_id];
    }

    // 4. Query reservations with all joins
    let query = supabaseAdmin
      .from('reservations')
      .select(
        `id, trip_id, agency_id, booker_name, booker_document, qr_code, status, created_at,
         agencies(id, name),
         trips(id, departure_time, status, capacity, vehicle_type, route_id, routes(id, origin, destination)),
         reservation_passengers(id, name, document, phone, boarded, boarded_at, seat_id, seats(seat_code))`
      )
      .order('created_at', { ascending: false });

    if (params.status) query = query.eq('status', params.status);
    if (params.agency_id) query = query.eq('agency_id', params.agency_id);
    if (effectiveTripIds) query = query.in('trip_id', effectiveTripIds);

    const { data, error } = await query;
    if (error) throw new ValidationError(error.message);

    return this._buildPassengerTree(data || []);
  }

  // ─── Search resolution ─────────────────────────────────────────────────
  // Resolves free-text search to a set of matching trip_ids.

  private async _resolveSearchTripIds(q: string): Promise<string[]> {
    const tripIds = new Set<string>();

    const [
      routeMatches,
      passengerMatches,
      agencyMatches,
      qrMatches,
      seatMatches,
      bookerMatches,
    ] = await Promise.all([
      supabaseAdmin
        .from('routes')
        .select('id')
        .or(`origin.ilike.%${q}%,destination.ilike.%${q}%`),
      supabaseAdmin
        .from('reservation_passengers')
        .select('reservation_id')
        .or(`name.ilike.%${q}%,document.ilike.%${q}%`),
      supabaseAdmin
        .from('agencies')
        .select('id')
        .ilike('name', `%${q}%`),
      supabaseAdmin
        .from('reservations')
        .select('trip_id')
        .ilike('qr_code', `%${q}%`),
      supabaseAdmin
        .from('seats')
        .select('id')
        .ilike('seat_code', `%${q}%`),
      supabaseAdmin
        .from('reservations')
        .select('trip_id')
        .or(`booker_name.ilike.%${q}%,booker_document.ilike.%${q}%`),
    ]);

    // Routes → trips
    if (routeMatches.data && routeMatches.data.length > 0) {
      const routeIds = routeMatches.data.map((r: any) => r.id);
      const { data: trips } = await supabaseAdmin
        .from('trips')
        .select('id')
        .in('route_id', routeIds);
      (trips || []).forEach((t: any) => tripIds.add(t.id));
    }

    // Passengers → reservations → trips
    if (passengerMatches.data && passengerMatches.data.length > 0) {
      const resIds = passengerMatches.data.map((p: any) => p.reservation_id);
      const { data: reservations } = await supabaseAdmin
        .from('reservations')
        .select('trip_id')
        .in('id', resIds);
      (reservations || []).forEach((r: any) => tripIds.add(r.trip_id));
    }

    // Agencies → reservations → trips
    if (agencyMatches.data && agencyMatches.data.length > 0) {
      const agencyIds = agencyMatches.data.map((a: any) => a.id);
      const { data: reservations } = await supabaseAdmin
        .from('reservations')
        .select('trip_id')
        .in('agency_id', agencyIds);
      (reservations || []).forEach((r: any) => tripIds.add(r.trip_id));
    }

    // QR → trips
    (qrMatches.data || []).forEach((r: any) => tripIds.add(r.trip_id));

    // Seat code → passengers → reservations → trips
    if (seatMatches.data && seatMatches.data.length > 0) {
      const seatIds = seatMatches.data.map((s: any) => s.id);
      const { data: rpMatches } = await supabaseAdmin
        .from('reservation_passengers')
        .select('reservation_id')
        .in('seat_id', seatIds);
      if (rpMatches && rpMatches.length > 0) {
        const resIds = rpMatches.map((p: any) => p.reservation_id);
        const { data: reservations } = await supabaseAdmin
          .from('reservations')
          .select('trip_id')
          .in('id', resIds);
        (reservations || []).forEach((r: any) => tripIds.add(r.trip_id));
      }
    }

    // Booker → trips
    (bookerMatches.data || []).forEach((r: any) => tripIds.add(r.trip_id));

    return [...tripIds];
  }

  // ─── Tree builder ──────────────────────────────────────────────────────
  // Transforms flat reservation rows into:
  // Route → Trip → { stats, reservations[] → passengers[] }

  private _buildPassengerTree(reservations: any[]) {
    const routeMap = new Map<
      string,
      {
        routeId: string;
        origin: string;
        destination: string;
        trips: Map<
          string,
          {
            tripId: string;
            departureTime: string;
            status: string;
            capacity: number | null;
            reservations: Map<
              string,
              {
                reservationId: string;
                status: string;
                qrCode: string;
                agency: { id: string; name: string } | null;
                passengers: any[];
              }
            >;
          }
        >;
      }
    >();

    for (const r of reservations) {
      const trip = r.trips;
      const route = trip?.routes;
      if (!trip || !route) continue;

      // Ensure route group
      if (!routeMap.has(route.id)) {
        routeMap.set(route.id, {
          routeId: route.id,
          origin: route.origin,
          destination: route.destination,
          trips: new Map(),
        });
      }
      const routeGroup = routeMap.get(route.id)!;

      // Ensure trip group
      if (!routeGroup.trips.has(trip.id)) {
        routeGroup.trips.set(trip.id, {
          tripId: trip.id,
          departureTime: trip.departure_time,
          status: trip.status,
          capacity: trip.capacity ?? null,
          reservations: new Map(),
        });
      }
      const tripGroup = routeGroup.trips.get(trip.id)!;

      // Ensure reservation group
      if (!tripGroup.reservations.has(r.id)) {
        const agency = r.agencies;
        tripGroup.reservations.set(r.id, {
          reservationId: r.id,
          status: r.status,
          qrCode: r.qr_code,
          agency: agency ? { id: agency.id, name: agency.name } : null,
          passengers: [],
        });
      }
      const resGroup = tripGroup.reservations.get(r.id)!;

      // Add passengers
      if (r.reservation_passengers && r.reservation_passengers.length > 0) {
        for (const p of r.reservation_passengers) {
          resGroup.passengers.push({
            rowId: p.id,
            passengerId: p.id,
            name: p.name,
            document: p.document,
            seatCode: p.seats?.seat_code || null,
            boarded: p.boarded,
          });
        }
      } else {
        // Legacy: reservation without passengers — use booker info
        resGroup.passengers.push({
          rowId: `legacy-${r.id}`,
          passengerId: null,
          name: r.booker_name,
          document: r.booker_document,
          seatCode: null,
          boarded: false,
        });
      }
    }

    // Convert maps to sorted arrays and compute stats
    const groups = [];
    for (const [, rg] of routeMap) {
      const trips = [];
      for (const [, tg] of rg.trips) {
        // Sort passengers by seat code within each reservation
        for (const [, res] of tg.reservations) {
          res.passengers.sort((a: any, b: any) =>
            (a.seatCode || '\uffff').localeCompare(b.seatCode || '\uffff', undefined, { numeric: true })
          );
        }

        // Compute trip stats
        const allPassengers: any[] = [];
        let cancelled = 0;
        let boarded = 0;
        for (const [, res] of tg.reservations) {
          if (res.status === 'cancelled') cancelled += res.passengers.length;
          for (const p of res.passengers) {
            if (p.boarded) boarded++;
            allPassengers.push(p);
          }
        }

        trips.push({
          tripId: tg.tripId,
          departureTime: tg.departureTime,
          status: tg.status,
          capacity: tg.capacity,
          stats: {
            reservations: tg.reservations.size,
            passengers: allPassengers.length,
            boarded,
            cancelled,
          },
          reservations: [...tg.reservations.values()],
        });
      }

      trips.sort(
        (a, b) =>
          new Date(b.departureTime).getTime() -
          new Date(a.departureTime).getTime()
      );

      groups.push({
        routeId: rg.routeId,
        origin: rg.origin,
        destination: rg.destination,
        trips,
      });
    }

    groups.sort((a, b) => a.origin.localeCompare(b.origin));
    return groups;
  }
}

export const reservationService = new ReservationService();
