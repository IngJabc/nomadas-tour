export type SeatStatus = 'available' | 'locked' | 'reserved' | 'blocked' | 'guide' | 'boarded';

export type ReservationOrigin = 'new_reservation' | 'agency_trips';

export interface Route {
  id: string;
  origin: string;
  destination: string;
  status: 'active' | 'inactive';
  created_by: string;
}

export interface Trip {
  id: string;
  route_id: string;
  departure_time: string;
  capacity: number;
  vehicle_type: 'bus' | 'kia';
  status: 'active' | 'cancelled' | 'completed';
  route?: Route | null;
  routes?: Route | null;
  seats?: Seat[];
}

export interface AgencyTripListItem {
  id: string;
  route: { origin: string; destination: string } | null;
  departure_time: string;
  vehicle_type: 'bus' | 'kia';
  status: string;
  total_seats: number;
  available_seats: number;
  reserved_seats: number;
}

export interface Seat {
  id: string;
  trip_id: string;
  seat_code: string;
  status: SeatStatus;
  locked_by: string | null;
  locked_at: string | null;
  updated_at: string;
}

export interface TripAgencyAllocation {
  id: string;
  trip_id: string;
  agency_id: string;
  allocated_seats: number;
  reserved_seats: number;
}

export interface Reservation {
  id: string;
  trip_id: string;
  agency_id: string;
  user_id: string;
  transaction_id: string;
  customer_name: string;
  passenger_cedula: string;
  phone: string | null;
  seat_code: string;
  status: 'confirmed' | 'cancelled' | 'boarded';
  qr_code: string;
  created_at: string;
}

export interface ReservationPayload {
  trip_id: string;
  booker_name: string;
  booker_document: string;
  booker_phone?: string;
  passengers: { seat_id: string; name: string; document: string; phone?: string }[];
}

export interface ReservationResult {
  reservation: Reservation;
  passengers: { id: string; seat_code: string; name: string; document: string }[];
  qr_code: string;
  qr_data_url: string;
}

export interface PassengerData {
  seat_id: string;
  seat_code: string;
  name: string;
  document: string;
  phone: string;
}

export interface Agency {
  id: string;
  name: string;
  subdomain: string;
  email: string | null;
  phone: string | null;
  status: 'active' | 'inactive' | 'pending';
  tripCount?: number;
  reservationCount?: number;
}

export interface BusRow {
  left: (string | null)[];
  right: (string | null)[];
  isDoor?: boolean;
}

export interface AgencyReservationPassenger {
  id: string;
  name: string;
  document: string;
  phone?: string | null;
  status: string;
  seat_id: string;
  seats?: { seat_code: string };
  boarded?: boolean;
}

export interface AgencyReservation {
  id: string;
  booker_name: string;
  booker_document: string;
  booker_phone?: string | null;
  status: string;
  qr_code: string;
  qr_data_url?: string | null;
  trip_id: string;
  created_at: string;
  trips: {
    id: string;
    departure_time: string;
    vehicle_type: string;
    routes: { origin: string; destination: string } | null;
  } | null;
  reservation_passengers?: AgencyReservationPassenger[];
}

export interface AgencyTripPassenger {
  id: string;
  name: string;
  document: string;
  phone: string | null;
  seat_code: string;
  reservation_id: string;
  reservation_status: string;
  booker_name: string;
  boarded: boolean;
}

export interface AgencyTripPassengersResponse {
  trip: {
    id: string;
    departure_time: string;
    vehicle_type: string;
    route: { origin: string; destination: string } | null;
    total_seats: number;
    available_seats: number;
    reserved_seats: number;
  };
  passengers: AgencyTripPassenger[];
  stats: {
    total: number;
    reserved: number;
    boarded: number;
  };
}
