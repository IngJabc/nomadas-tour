import { supabaseAdmin } from '../config/database.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from '../errors/index.js';

export const PROOF_BUCKET = 'payment-proofs';
export const PROOF_SIGNED_URL_TTL_SECONDS = 300;

export type CheckoutAttemptStatusFilter =
  | 'created'
  | 'pending_review'
  | 'rejected'
  | 'verified'
  | 'rejected_final'
  | 'expired'
  | 'cancelled';

const LIST_SELECT = `
  id, status, amount_cents, seat_ids, passenger_data, proof_count,
  payment_reference, bank_origin, proof_path, proof_submitted_at,
  review_started_at, rejection_reason, expires_at, created_at,
  trips (
    id, departure_time,
    routes ( origin, destination )
  )
`;

const DETAIL_SELECT = `
  id, status, trip_id, agency_id, customer_id, seat_ids, passenger_data,
  unit_price, amount_cents, proof_count, payment_reference, bank_origin,
  payment_datetime, proof_path, proof_submitted_at, review_started_at,
  rejection_reason, rejection_count, history, expires_at, created_at,
  closed_at, verified_at, verified_by,
  payment_method_id, payment_method_snapshot,
  trips (
    id, departure_time, vehicle_type, seat_price,
    routes ( origin, destination )
  )
`;

// ── Row / view types ─────────────────────────────────────────────────────────

interface NormalizedRoute {
  origin: string;
  destination: string;
}

interface NormalizedTrip {
  id: string;
  departure_time: string;
  vehicle_type?: string;
  seat_price?: number | null;
  routes?: unknown;
}

interface PassengerSnapshot {
  seat_id?: string;
  first_name?: string;
  last_name?: string;
  document?: string;
  phone?: string | null;
}

interface CheckoutAttemptListRow {
  id: string;
  status: string;
  amount_cents: number;
  seat_ids: string[];
  passenger_data: PassengerSnapshot[];
  proof_count: number;
  payment_reference: string | null;
  bank_origin: string | null;
  proof_path: string | null;
  proof_submitted_at: string | null;
  review_started_at: string | null;
  rejection_reason: string | null;
  expires_at: string;
  created_at: string;
  trips: unknown;
}

interface CheckoutAttemptDetailRow {
  id: string;
  status: string;
  trip_id: string;
  agency_id: string;
  customer_id: string;
  seat_ids: string[];
  passenger_data: PassengerSnapshot[];
  unit_price: number;
  amount_cents: number;
  proof_count: number;
  payment_reference: string | null;
  bank_origin: string | null;
  payment_datetime: string | null;
  proof_path: string | null;
  proof_submitted_at: string | null;
  review_started_at: string | null;
  rejection_reason: string | null;
  rejection_count: number;
  history: unknown[];
  expires_at: string;
  created_at: string;
  closed_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  payment_method_id: string | null;
  payment_method_snapshot: Record<string, unknown> | null;
  trips: unknown;
}

export interface ListCheckoutAttemptsInput {
  agencyId: string;
  status?: CheckoutAttemptStatusFilter;
  tripId?: string;
  q?: string;
  page: number;
  limit: number;
}

export interface CheckoutAttemptListItem {
  id: string;
  status: string;
  amount_cents: number;
  passenger_count: number;
  proof_count: number;
  has_proof: boolean;
  payment_reference: string | null;
  bank_origin: string | null;
  submitted_at: string | null;
  rejection_reason: string | null;
  expires_at: string;
  created_at: string;
  booker: {
    name: string;
    document: string;
    phone: string | null;
  };
  trip: {
    id: string;
    departure_time: string;
    origin: string;
    destination: string;
  } | null;
}

export interface ListCheckoutAttemptsResult {
  attempts: CheckoutAttemptListItem[];
  page: number;
  limit: number;
  total: number;
}

export interface CheckoutAttemptPassenger {
  seat_id: string;
  seat_code: string | null;
  first_name: string;
  last_name: string;
  name: string;
  document: string;
  phone: string | null;
}

export interface CheckoutAttemptDetail {
  attempt: {
    id: string;
    status: string;
    reservation_id: string | null;
    amount_cents: number;
    unit_price: number;
    passenger_count: number;
    proof_count: number;
    remaining_submissions: number;
    payment_reference: string | null;
    bank_origin: string | null;
    payment_datetime: string | null;
    proof_submitted_at: string | null;
    review_started_at: string | null;
    rejection_reason: string | null;
    rejection_count: number;
    expires_at: string;
    created_at: string;
    closed_at: string | null;
    verified_at: string | null;
    verified_by: string | null;
    has_proof: boolean;
    payment_method_id: string | null;
    payment_method_snapshot: Record<string, unknown> | null;
  };
  trip: {
    id: string;
    departure_time: string;
    vehicle_type: string;
    seat_price: number | null;
    origin: string;
    destination: string;
  } | null;
  passengers: CheckoutAttemptPassenger[];
  history: unknown[];
}

export interface VerifyCheckoutAttemptResult {
  attempt_id: string;
  status: string;
  already_verified: boolean;
  reservation_id: string | null;
  payment_id: string | null;
  amount_cents: number;
  currency: string;
  proof_count: number;
  allocation_count: number;
  passenger_count: number;
  verified_at: string;
  verified_by: string;
  payment_status: string;
  audit_id: string;
  reservation_audit_id: string | null;
}

export interface RejectCheckoutAttemptResult {
  attempt_id: string;
  status: string;
  already_rejected: boolean;
  final: boolean;
  proof_count: number;
  remaining_submissions: number;
  rejection_reason: string;
  freed_seats: number;
  audit_id?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function firstOrNull<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizeTrip(trips: unknown): NormalizedTrip | null {
  return firstOrNull<NormalizedTrip>(trips as NormalizedTrip | NormalizedTrip[] | null);
}

function normalizeRoute(routes: unknown): NormalizedRoute | null {
  return firstOrNull<NormalizedRoute>(
    routes as NormalizedRoute | NormalizedRoute[] | null,
  );
}

function bookerFrom(passengers: PassengerSnapshot[]): {
  name: string;
  document: string;
  phone: string | null;
} {
  const first = passengers[0];
  const name = [first?.first_name, first?.last_name]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return {
    name,
    document: (first?.document ?? '').trim(),
    phone: (first?.phone ?? '').trim() || null,
  };
}

function mapListItem(row: CheckoutAttemptListRow): CheckoutAttemptListItem {
  const trip = normalizeTrip(row.trips);
  const route = normalizeRoute(trip?.routes);
  const passengers = Array.isArray(row.passenger_data) ? row.passenger_data : [];

  return {
    id: row.id,
    status: row.status,
    amount_cents: row.amount_cents,
    passenger_count: row.seat_ids?.length ?? 0,
    proof_count: row.proof_count,
    has_proof: Boolean(row.proof_path),
    payment_reference: row.payment_reference,
    bank_origin: row.bank_origin,
    submitted_at: row.proof_submitted_at,
    rejection_reason: row.rejection_reason,
    expires_at: row.expires_at,
    created_at: row.created_at,
    booker: bookerFrom(passengers),
    trip: trip
      ? {
          id: trip.id,
          departure_time: trip.departure_time,
          origin: route?.origin ?? '',
          destination: route?.destination ?? '',
        }
      : null,
  };
}

function rpcErrorCode(message: string): string | null {
  const match = /ERR_[A-Z0-9_]+/.exec(message || '');
  return match ? match[0] : null;
}

/**
 * Traduce los RAISE EXCEPTION de las RPC 087 al envelope estándar del
 * backend de Tour. Los ownership incorrectos responden 404 para no
 * filtrar que el intento pertenece a otra agencia; los de rol responden
 * 403.
 */
function mapCheckoutRpcError(error: { message: string }): Error {
  const code = rpcErrorCode(error.message || '');

  switch (code) {
    case 'ERR_CHECKOUT_INPUT':
      return new ValidationError('Datos inválidos');
    case 'ERR_CHECKOUT_ATTEMPT_NOT_FOUND':
    case 'ERR_CHECKOUT_NOT_OWNER':
      return new NotFoundError('Compra no encontrada');
    case 'ERR_CHECKOUT_AGENCY_MISMATCH':
    case 'ERR_CHECKOUT_ADMIN_ROLE':
    case 'ERR_CHECKOUT_ADMIN_USER':
      return new ForbiddenError('No autorizado');
    case 'ERR_CHECKOUT_RECONCILIATION':
      return new ValidationError('Los datos de conciliación son obligatorios');
    case 'ERR_CHECKOUT_NO_PROOF':
      return new ConflictError('Esta compra todavía no tiene comprobante que revisar');
    case 'ERR_CHECKOUT_PROOF_PENDING':
      return new ConflictError('Esta compra ya tiene un comprobante en revisión');
    case 'ERR_CHECKOUT_WINDOW_EXPIRED':
      return new ConflictError('El plazo de revisión de esta compra venció');
    case 'ERR_CHECKOUT_ATTEMPT_CLOSED':
      return new ConflictError('Esta compra ya fue cerrada');
    case 'ERR_CHECKOUT_ALREADY_VERIFIED':
      return new ConflictError('Esta compra ya fue aprobada');
    case 'ERR_CHECKOUT_PROOF_LIMIT':
      return new ConflictError('Esta compra ya agotó sus comprobantes');
    case 'ERR_CHECKOUT_NOT_PENDING_REVIEW':
      return new ConflictError('Esta compra no está pendiente de revisión');
    case 'ERR_CHECKOUT_REJECT_REASON':
      return new ValidationError('El motivo de rechazo es obligatorio (1-500 caracteres)');
    case 'ERR_CHECKOUT_VERIFY_INCONSISTENT':
    case 'ERR_CHECKOUT_VERIFY_PASSENGERS':
    case 'ERR_CHECKOUT_VERIFY_PRICE':
    case 'ERR_CHECKOUT_VERIFY_SEATS':
    case 'ERR_CHECKOUT_VERIFY_AMOUNT':
    case 'ERR_CHECKOUT_VERIFY_ALLOCATIONS':
      return new UnprocessableError(
        'No se pudo aprobar la compra: los datos no son consistentes',
        'CHECKOUT_VERIFY_INCONSISTENT',
      );
    case 'ERR_CHECKOUT_RACE':
      return new ConflictError(
        'El estado de la compra cambió durante la operación. Intenta de nuevo',
      );
    case 'ERR_CHECKOUT_LOCK_EXPIRED':
      return new ConflictError(
        'Los asientos de esta compra ya no están reservados. Intenta de nuevo',
      );
    default:
      return new AppError(
        'No se pudo procesar la operación. Intenta de nuevo',
        500,
        'CHECKOUT_ADMIN_ERROR',
      );
  }
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabaseAdmin.rpc(fn, args);
  if (error) throw mapCheckoutRpcError(error);
  return data;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class CheckoutAttemptService {
  async list(input: ListCheckoutAttemptsInput): Promise<ListCheckoutAttemptsResult> {
    const from = (input.page - 1) * input.limit;
    const to = from + input.limit - 1;

    let query = supabaseAdmin
      .from('checkout_attempts')
      .select(LIST_SELECT, { count: 'exact' })
      .eq('agency_id', input.agencyId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    if (input.status) {
      query = query.eq('status', input.status);
    }
    if (input.tripId) {
      query = query.eq('trip_id', input.tripId);
    }
    if (input.q) {
      const needle = input.q.replace(/[%_,()]/g, ' ').trim();
      if (needle) {
        query = query.or(
          `payment_reference.ilike.%${needle}%,bank_origin.ilike.%${needle}%`,
        );
      }
    }

    const { data, error, count } = await query;

    if (error) {
      throw new AppError(
        'No se pudieron listar las compras. Intenta de nuevo',
        500,
        'CHECKOUT_LIST_ERROR',
      );
    }

    return {
      attempts: ((data ?? []) as unknown as CheckoutAttemptListRow[]).map(mapListItem),
      page: input.page,
      limit: input.limit,
      total: count ?? 0,
    };
  }

  async getDetail(input: {
    attemptId: string;
    agencyId: string;
  }): Promise<CheckoutAttemptDetail> {
    const { data, error } = await supabaseAdmin
      .from('checkout_attempts')
      .select(DETAIL_SELECT)
      .eq('id', input.attemptId)
      .eq('agency_id', input.agencyId)
      .maybeSingle();

    if (error) {
      throw new AppError(
        'No se pudo cargar la compra. Intenta de nuevo',
        500,
        'CHECKOUT_DETAIL_ERROR',
      );
    }
    if (!data) {
      throw new NotFoundError('Compra no encontrada');
    }

    const row = data as unknown as CheckoutAttemptDetailRow;
    const trip = normalizeTrip(row.trips);
    const route = normalizeRoute(trip?.routes);
    const snapshot = Array.isArray(row.passenger_data) ? row.passenger_data : [];

    const { data: seats, error: seatsError } = await supabaseAdmin
      .from('seats')
      .select('id, seat_code')
      .in('id', row.seat_ids);

    if (seatsError) {
      throw new AppError(
        'No se pudo cargar la compra. Intenta de nuevo',
        500,
        'CHECKOUT_DETAIL_ERROR',
      );
    }

    const codeById = new Map<string, string>(
      ((seats ?? []) as { id: string; seat_code: string }[]).map((s) => [s.id, s.seat_code]),
    );

    const passengers: CheckoutAttemptPassenger[] = snapshot.map((p) => {
      const seatId = p.seat_id ?? '';
      const first = (p.first_name ?? '').trim();
      const last = (p.last_name ?? '').trim();
      return {
        seat_id: seatId,
        seat_code: codeById.get(seatId) ?? null,
        first_name: first,
        last_name: last,
        name: [first, last].filter(Boolean).join(' '),
        document: (p.document ?? '').trim(),
        phone: (p.phone ?? '').trim() || null,
      };
    });

    // MKT-007: la reserva definitiva nace al verificar el intento. El vinculo
    // queda en el pago creado (idempotency_key 'mkt007:<id>:verify'), asi que
    // se resuelve desde ahi para poder enlazar la reserva asociada. Best-effort:
    // si no se encuentra, el detalle sigue siendo valido sin enlace.
    let reservationId: string | null = null;
    if (row.status === 'verified') {
      const { data: paymentRow } = await supabaseAdmin
        .from('payments')
        .select('reservation_id')
        .eq('idempotency_key', `mkt007:${row.id}:verify`)
        .maybeSingle();
      reservationId =
        (paymentRow as { reservation_id: string } | null)?.reservation_id ?? null;
    }

    return {
      attempt: {
        id: row.id,
        status: row.status,
        reservation_id: reservationId,
        amount_cents: row.amount_cents,
        unit_price: row.unit_price,
        passenger_count: row.seat_ids?.length ?? 0,
        proof_count: row.proof_count,
        remaining_submissions: Math.max(0, 3 - row.proof_count),
        payment_reference: row.payment_reference,
        bank_origin: row.bank_origin,
        payment_datetime: row.payment_datetime,
        proof_submitted_at: row.proof_submitted_at,
        review_started_at: row.review_started_at,
        rejection_reason: row.rejection_reason,
        rejection_count: row.rejection_count ?? 0,
        expires_at: row.expires_at,
        created_at: row.created_at,
        closed_at: row.closed_at,
        verified_at: row.verified_at,
        verified_by: row.verified_by,
        has_proof: Boolean(row.proof_path),
        payment_method_id: row.payment_method_id ?? null,
        payment_method_snapshot: row.payment_method_snapshot ?? null,
      },
      trip: trip
        ? {
            id: trip.id,
            departure_time: trip.departure_time,
            vehicle_type: trip.vehicle_type ?? '',
            seat_price: trip.seat_price ?? null,
            origin: route?.origin ?? '',
            destination: route?.destination ?? '',
          }
        : null,
      passengers,
      history: Array.isArray(row.history) ? row.history : [],
    };
  }

  /**
   * URL firmada de corta duración para el comprobante. La ruta NUNCA
   * llega del cliente: se lee de `checkout_attempts.proof_path` y se
   * valida que viva bajo el directorio UUID del propio intento.
   */
  async getProofSignedUrl(input: {
    attemptId: string;
    agencyId: string;
  }): Promise<{ url: string; expires_in_seconds: number }> {
    const { data, error } = await supabaseAdmin
      .from('checkout_attempts')
      .select('id, proof_path')
      .eq('id', input.attemptId)
      .eq('agency_id', input.agencyId)
      .maybeSingle();

    if (error) {
      throw new AppError(
        'No se pudo cargar el comprobante. Intenta de nuevo',
        500,
        'CHECKOUT_PROOF_ERROR',
      );
    }
    if (!data) {
      throw new NotFoundError('Compra no encontrada');
    }

    const proofPath = (data as { proof_path: string | null }).proof_path;
    if (!proofPath) {
      throw new NotFoundError('Esta compra no tiene comprobante adjunto');
    }

    const separator = proofPath.indexOf('/');
    const dir = separator > 0 ? proofPath.slice(0, separator) : '';
    const filename = separator > 0 ? proofPath.slice(separator + 1) : '';

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dir);
    if (
      !isUuid ||
      dir !== input.attemptId ||
      filename.includes('/') ||
      filename.includes('..') ||
      !/\.[a-z0-9]+$/i.test(filename)
    ) {
      throw new NotFoundError('Esta compra no tiene comprobante adjunto');
    }

    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(PROOF_BUCKET)
      .createSignedUrl(proofPath, PROOF_SIGNED_URL_TTL_SECONDS);

    if (signError || !signed?.signedUrl) {
      throw new AppError(
        'No se pudo generar el enlace del comprobante. Intenta de nuevo',
        500,
        'CHECKOUT_PROOF_ERROR',
      );
    }

    return { url: signed.signedUrl, expires_in_seconds: PROOF_SIGNED_URL_TTL_SECONDS };
  }

  async verify(input: {
    attemptId: string;
    actorUserId: string;
  }): Promise<VerifyCheckoutAttemptResult> {
    const data = await callRpc('verify_checkout_attempt', {
      p_attempt_id: input.attemptId,
      p_actor_user_id: input.actorUserId,
    });

    if (!data || typeof data !== 'object' || !(data as { attempt_id?: string }).attempt_id) {
      throw new AppError(
        'No se pudo aprobar la compra. Intenta de nuevo',
        500,
        'CHECKOUT_VERIFY_ERROR',
      );
    }

    return data as VerifyCheckoutAttemptResult;
  }

  async reject(input: {
    attemptId: string;
    actorUserId: string;
    reason: string;
  }): Promise<RejectCheckoutAttemptResult> {
    const data = await callRpc('reject_checkout_attempt', {
      p_attempt_id: input.attemptId,
      p_actor_user_id: input.actorUserId,
      p_reason: input.reason,
    });

    if (!data || typeof data !== 'object' || !(data as { attempt_id?: string }).attempt_id) {
      throw new AppError(
        'No se pudo rechazar la compra. Intenta de nuevo',
        500,
        'CHECKOUT_REJECT_ERROR',
      );
    }

    return data as RejectCheckoutAttemptResult;
  }
}

export const checkoutAttemptService = new CheckoutAttemptService();
