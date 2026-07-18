export interface ReservationTicketPassenger {
  id: string;
  name: string;
  document: string;
  seat_code: string;
  boarded: boolean;
}

export interface ReservationTicketTrip {
  id: string;
  departure_time: string;
  origin: string;
  destination: string;
  vehicle_type: 'bus' | 'kia';
  status: string;
}

export interface ReservationTicketData {
  reservation_id: string;
  qr_code: string;
  status: string;
  created_at: string;
  booker_name: string;
  booker_document: string;
  booker_phone?: string | null;
  trip: ReservationTicketTrip | null;
  passengers: ReservationTicketPassenger[];
}

export const VEHICLE_LABELS: Record<string, string> = {
  bus: 'Autobús',
  kia: 'KIA',
  van: 'Van',
  microbús: 'Microbús',
};
