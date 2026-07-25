export interface TicketPassenger {
  id: string;
  name: string;
  document: string;
  seat_code: string;
  boarded: boolean;
}

export interface TicketTrip {
  id: string;
  departure_time: string;
  origin: string;
  destination: string;
  vehicle_type: 'bus' | 'kia';
  status: string;
  postponed_from: string | null;
}

export interface TicketData {
  reservation_id: string;
  qr_code: string;
  qr_data_url: string;
  status: string;
  created_at: string;
  booker_name: string;
  booker_document: string;
  booker_phone: string | null;
  trip: TicketTrip | null;
  passengers: TicketPassenger[];
}

export const VEHICLE_LABELS: Record<string, string> = {
  bus: 'Autobús',
  kia: 'KIA',
  van: 'Van',
  microbús: 'Microbús',
};
