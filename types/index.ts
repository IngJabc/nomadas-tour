export type SeatStatus = 'available' | 'locked' | 'reserved' | 'blocked' | 'guide' | 'boarded';

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
