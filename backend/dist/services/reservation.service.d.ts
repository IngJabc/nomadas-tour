export declare class ReservationService {
    listActiveTrips(): Promise<any[]>;
    getTripWithSeats(tripId: string): Promise<any>;
    getAvailableAgencies(tripId: string): Promise<{
        agency_id: any;
        agency_name: any;
        available: number;
    }[]>;
    createReservation(tripId: string, customerName: string, passengerCedula: string, phone: string | null, seatCodes: string[], userId: string | null): Promise<{
        transaction_id: `${string}-${string}-${string}-${string}-${string}`;
        qr_code: string;
        qr_data_url: string;
        reservations: {
            trip_id: string;
            agency_id: string;
            user_id: string | null;
            transaction_id: `${string}-${string}-${string}-${string}-${string}`;
            customer_name: string;
            passenger_cedula: string;
            phone: string | null;
            seat_code: string;
            status: string;
            qr_code: string;
        }[];
        total: number;
    }>;
    cancelReservation(tripId: string, transactionId: string, requestingAgencyId: string | null, isSuperadmin: boolean): Promise<{
        cancelled: boolean;
        seat_codes: any[];
    }>;
    boardPassenger(tripId: string, qrCode: string, scannedBy: string, agencyId: string | null, isSuperadmin: boolean): Promise<{
        boarded: boolean;
        seat_codes: any[];
    }>;
    createAgencyReservation(tripId: string, bookerName: string, bookerDocument: string, bookerPhone: string | null, passengers: {
        seat_id: string;
        name: string;
        document: string;
        phone: string | null;
    }[], agencyId: string, userId: string): Promise<{
        reservation: any;
        passengers: any;
        qr_code: string;
        qr_data_url: string;
    }>;
    getAgencyReservations(agencyId: string): Promise<any[]>;
    getAgencyReservationById(id: string, agencyId: string): Promise<any>;
    cancelAgencyReservation(id: string, agencyId: string): Promise<{
        cancelled: boolean;
        reservation_id: string;
        freed_seats: any;
    }>;
    cancelUserReservation(tripId: string, transactionId: string, userId: string): Promise<{
        cancelled: boolean;
        seat_codes: any[];
    }>;
    getUserReservations(userId: string): Promise<any[]>;
    lookupReservationByQR(qrCode: string, agencyId: string): Promise<{
        reservation_id: any;
        trip_id: any;
        booker_name: any;
        status: any;
        total_passengers: number;
        boarded_count: number;
        seat_ids: any[];
        trip: any;
    }>;
    boardPassengers(qrCode: string, seatIds: string[], scannedBy: string, agencyId: string): Promise<{
        boarded: number;
        reservation_status: string;
        total_passengers: number;
        boarded_count: number;
    }>;
    getAllReservations(filters?: {
        agency_id?: string;
        trip_id?: string;
        status?: string;
    }): Promise<any[]>;
    getAgencyDashboard(agencyId: string): Promise<{
        agency_name: any;
        total_trips: number;
        active_trips: number;
        total_reservations: number;
        today_reservations: number;
        pending_boarding_passengers: number;
        upcoming_trips: any[];
        recent_activity: any[];
        occupancy_by_trip: any[];
    }>;
    getAgencyTrips(agencyId: string): Promise<{
        id: any;
        route: any;
        departure_time: any;
        vehicle_type: any;
        status: any;
        total_seats: number;
        available_seats: number;
        reserved_seats: number;
    }[]>;
    lockSeat(tripId: string, seatId: string, userId: string, agencyId: string): Promise<{
        locked: boolean;
        seat_id: string;
    }>;
    unlockSeat(tripId: string, seatId: string, userId: string, agencyId: string): Promise<{
        unlocked: boolean;
        seat_id: string;
    }>;
    unlockAllSeats(tripId: string, userId: string, agencyId: string): Promise<{
        unlocked: number;
    }>;
    releaseExpiredLocks(): Promise<{
        released: number;
    }>;
}
export declare const reservationService: ReservationService;
//# sourceMappingURL=reservation.service.d.ts.map