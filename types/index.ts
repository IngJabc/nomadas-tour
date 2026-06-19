export type SeatStatus = 'available' | 'reserved' | 'locked';

export interface Route {
  id: string;
  origin: string;
  destination: string;
  duration_minutes: number;
  created_at: string;
}

export interface Trip {
  id: string;
  route_id: string;
  departure_at: string;
  price: number;
  status: 'active' | 'cancelled' | 'completed';
  total_seats: number;
  decks: number;
  route?: Route;
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

export interface Booking {
  id: string;
  user_id: string;
  trip_id: string;
  seat_id: string;
  passenger_name: string;
  passenger_email: string;
  qr_code: string;
  status: 'confirmed' | 'cancelled';
  created_at: string;
  seat?: Seat;
  trip?: Trip & { route: Route };
}

export interface BusRow {
  left: (string | null)[];
  right: (string | null)[];
}

export interface BusLayout {
  totalSeats: number;
  guideSeats: string[];
  rows: BusRow[];
  frontLeft: string;
}
