/** Minimal boarding lookup DTO (AUD-020). No documents, phones, or QR. */
export interface BoardingLookupDTO {
  trip: {
    id: string;
    status: string;
    departure_time: string;
    route: {
      origin: string;
      destination: string;
    };
  };
  reservation_status: string;
  reservation_agency_name: string;
  passengers: Array<{
    id: string;
    name: string;
    seat_code: string | null;
    boarded: boolean;
    boarded_at: string | null;
  }>;
}

export type BoardingLookupFailureCode =
  | 'EMPTY_INPUT'
  | 'CREDENTIAL_NOT_FOUND'
  | 'AGENCY_NOT_ASSIGNED'
  | 'TRIP_NOT_DEPARTED'
  | 'TRIP_INVALID'
  | 'TRIP_NOT_FOUND'
  | 'RESERVATION_CANCELLED';

/**
 * Single-result boarding lookup envelope.
 * Invariants: allowed ⇒ found; allowed ⇒ failure_code null; !allowed ⇒ failure_code set & result null.
 */
export interface BoardingLookupResponse {
  found: boolean;
  allowed: boolean;
  failure_code: BoardingLookupFailureCode | null;
  result: BoardingLookupDTO | null;
}

export interface BoardingToggleResult {
  passenger_id: string;
  boarded: boolean;
  boarded_at: string | null;
  changed: boolean;
  reservation_status: string;
  boarded_count: number;
  total_count: number;
}

export type BoardingAttemptOperation = 'lookup' | 'board' | 'unboard';

export type BoardingAttemptOutcome =
  | 'success'
  | 'no_change'
  | 'denied'
  | 'not_found'
  | 'error';

export interface BoardingAttemptInput {
  actor_user_id: string | null;
  operator_agency_id: string | null;
  trip_id?: string | null;
  reservation_id?: string | null;
  reservation_passenger_id?: string | null;
  operation: BoardingAttemptOperation;
  outcome: BoardingAttemptOutcome;
  failure_code?: string | null;
  credential_hash?: string | null;
}
