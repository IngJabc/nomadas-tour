import { z } from 'zod';

export type Role = 'superadmin' | 'agency';

export interface RequestContext {
  userId: string;
  role: Role;
  agencyId: string | null;
}

export interface User {
  id: string;
  email: string;
  role: Role;
  agency_id: string | null;
}

export interface Agency {
  id: string;
  name: string;
  subdomain: string;
  email: string | null;
  phone: string | null;
  status: 'active' | 'inactive' | 'pending';
  created_by: string;
}

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
  status: string;
  postponed_from: string | null;
  created_by: string;
}

export interface TripSummary {
  id: string;
  route_id: string;
  route: {
    origin: string;
    destination: string;
  };
  departure_time: string;
  vehicle: {
    type: 'bus' | 'kia';
    capacity: number;
  };
  status: string;
  postponed_from: string | null;
  occupancy: {
    total: number;
    available: number;
    reserved: number;
    boarded: number;
  };
  agencies: {
    id: string;
    name: string;
    reservation_count: number;
  }[];
  trip_agencies: {
    agency_id: string;
  }[];
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface Seat {
  id: string;
  trip_id: string;
  seat_code: string;
  status: 'available' | 'locked' | 'reserved' | 'blocked';
  locked_by: string | null;
  locked_at: string | null;
  updated_at: string;
}

export interface Reservation {
  id: string;
  trip_id: string;
  agency_id: string;
  created_by: string | null;
  booker_name: string;
  booker_document: string;
  booker_phone: string | null;
  qr_code: string;
  status: 'confirmed' | 'cancelled' | 'partial' | 'completed';
  created_at: string;
}

export interface TripAgency {
  id: string;
  trip_id: string;
  agency_id: string;
}

export interface ReservationPassenger {
  id: string;
  reservation_id: string;
  seat_id: string;
  name: string;
  document: string;
  phone: string | null;
  boarded: boolean;
  boarded_at: string | null;
}

export interface BoardingLog {
  id: string;
  reservation_id: string;
  scanned_by: string;
  scanned_by_agency_id: string | null;
  reservation_passenger_id: string | null;
  action: 'board' | 'unboard' | 'correction';
  seat_ids: string[];
  created_at: string;
}

export interface AgencyInvitation {
  id: string;
  agency_id: string;
  email: string;
  token: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  created_at: string;
}
