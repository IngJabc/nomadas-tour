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

export type AgencyPaymentStatusFilter = 'pending' | 'verified' | 'rejected';

export interface ListAgencyPaymentsInput {
  agencyId: string;
  status?: AgencyPaymentStatusFilter;
  page: number;
  limit: number;
}

export interface AgencyPaymentListItem {
  id: string;
  status: string;
  amount_cents: number;
  currency: string;
  submitted_at: string;
  verified_at: string | null;
  rejection_reason: string | null;
  has_proof: boolean;
  /** Intento de compra (MKT-007) que originó este pago, si lo hay. */
  checkout_attempt_id: string | null;
  reservation: {
    id: string;
    booker_name: string;
    contact_email: string | null;
    status: string;
    payment_status: string | null;
    trip: {
      id: string;
      departure_time: string;
      origin: string;
      destination: string;
    } | null;
  };
}

export interface ListAgencyPaymentsResult {
  payments: AgencyPaymentListItem[];
  page: number;
  limit: number;
  total: number;
}

export interface AgencyPaymentPassenger {
  id: string;
  seat_code: string | null;
  name: string;
  unit_price: number | null;
  status: string;
}

export interface AgencyPaymentAllocation {
  id: string;
  reservation_passenger_id: string;
  seat_code: string | null;
  amount_cents: number;
  created_at: string;
}

export interface AgencyPaymentDetail {
  payment: {
    id: string;
    status: string;
    amount_cents: number;
    currency: string;
    submitted_at: string;
    verified_at: string | null;
    verified_by: string | null;
    rejection_reason: string | null;
    has_proof: boolean;
  };
  reservation: {
    id: string;
    booker_name: string;
    booker_phone: string | null;
    contact_email: string | null;
    status: string;
    payment_status: string | null;
    created_at: string;
  };
  trip: {
    id: string;
    departure_time: string;
    vehicle_type: string;
    seat_price: number | null;
    origin: string;
    destination: string;
  } | null;
  passengers: AgencyPaymentPassenger[];
  allocations: AgencyPaymentAllocation[];
  totals: {
    active_passenger_count: number;
    expected_cents: number;
    allocated_cents: number;
    remaining_cents: number;
  };
}

export interface PaymentProofSignedUrlResult {
  url: string;
  expires_in_seconds: number;
}

export interface VerifyPaymentInput {
  paymentId: string;
  actorUserId: string;
}

export interface RejectPaymentInput {
  paymentId: string;
  actorUserId: string;
  reason: string;
}

export interface VerifyPaymentResult {
  payment_id: string;
  reservation_id: string;
  status: string;
  already_verified: boolean;
  amount_cents: number;
  currency: string;
  allocation_count: number;
  total_expected_cents: number;
  verified_at: string;
  verified_by: string;
  payment_status: string;
  audit_id: string;
}

export interface RejectPaymentResult {
  payment_id: string;
  reservation_id: string;
  status: string;
  already_rejected: boolean;
  rejection_reason: string;
  outcome: string;
  cancelled_reservation: boolean;
  reservation_status: string;
  payment_status: string;
  freed_seat_count: number;
  cancelled_passenger_count: number;
  refund_required: boolean;
  refund_amount_cents: number;
  payment_audit_id: string;
  reservation_audit_id: string | null;
}

interface PaymentListRow {
  id: string;
  status: string;
  amount_cents: number;
  currency: string;
  submitted_at: string;
  verified_at: string | null;
  rejection_reason: string | null;
  proof_url: string | null;
  reservation_id: string;
  idempotency_key: string | null;
  reservations: unknown;
}

interface PaymentDetailRow {
  id: string;
  status: string;
  amount_cents: number;
  currency: string;
  submitted_at: string;
  verified_at: string | null;
  verified_by: string | null;
  rejection_reason: string | null;
  proof_url: string | null;
  reservation_id: string;
  reservations: unknown;
}

type NormalizedTrip = {
  id: string;
  departure_time: string;
  vehicle_type?: string;
  seat_price?: number | null;
  routes: unknown;
};

type NormalizedReservation = {
  id: string;
  booker_name: string;
  booker_phone?: string | null;
  contact_email: string | null;
  status: string;
  payment_status: string | null;
  created_at?: string;
  trips: unknown;
};

const LIST_SELECT = `
  id, status, amount_cents, currency, submitted_at, verified_at,
  rejection_reason, proof_url, reservation_id, idempotency_key,
  reservations (
    id, booker_name, contact_email, status, payment_status,
    trips (
      id, departure_time,
      routes ( origin, destination )
    )
  )
`;

const DETAIL_SELECT = `
  id, status, amount_cents, currency, submitted_at, verified_at,
  verified_by, rejection_reason, proof_url, reservation_id,
  reservations (
    id, booker_name, booker_phone, contact_email, status, payment_status,
    created_at,
    trips (
      id, departure_time, vehicle_type, seat_price,
      routes ( origin, destination )
    )
  )
`;

function firstOrNull<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizeTrip(trips: unknown): NormalizedTrip | null {
  return firstOrNull<NormalizedTrip>(
    trips as NormalizedTrip | NormalizedTrip[] | null,
  );
}

function normalizeReservation(reservations: unknown): NormalizedReservation | null {
  return firstOrNull<NormalizedReservation>(
    reservations as NormalizedReservation | NormalizedReservation[] | null,
  );
}

function normalizeRoute(
  routes: unknown,
): { origin: string; destination: string } | null {
  return firstOrNull<{ origin: string; destination: string }>(
    routes as
      | { origin: string; destination: string }
      | { origin: string; destination: string }[]
      | null,
  );
}

/**
 * Resuelve el intento de compra (MKT-007) que originó un pago a partir de su
 * idempotency_key, con formato 'mkt007:<attempt_id>:verify'. Los pagos del
 * flujo legacy no lo traen y devuelven null.
 */
function checkoutAttemptIdFromIdempotencyKey(
  key: string | null | undefined,
): string | null {
  if (!key) return null;
  const match = /^mkt007:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):verify$/i.exec(
    key,
  );
  return match ? match[1].toLowerCase() : null;
}

function mapListItem(row: PaymentListRow): AgencyPaymentListItem {
  const reservation = normalizeReservation(row.reservations);
  const trip = normalizeTrip(reservation?.trips);
  const route = normalizeRoute(trip?.routes);
  return {
    id: row.id,
    status: row.status,
    amount_cents: row.amount_cents,
    currency: row.currency,
    submitted_at: row.submitted_at,
    verified_at: row.verified_at,
    rejection_reason: row.rejection_reason,
    has_proof: Boolean(row.proof_url),
    checkout_attempt_id: checkoutAttemptIdFromIdempotencyKey(row.idempotency_key),
    reservation: {
      id: reservation?.id ?? row.reservation_id,
      booker_name: reservation?.booker_name ?? '',
      contact_email: reservation?.contact_email ?? null,
      status: reservation?.status ?? '',
      payment_status: reservation?.payment_status ?? null,
      trip: trip
        ? {
            id: trip.id,
            departure_time: trip.departure_time,
            origin: route?.origin ?? '',
            destination: route?.destination ?? '',
          }
        : null,
    },
  };
}

function rpcErrorCode(message: string): string | null {
  const match = /ERR_[A-Z0-9_]+/.exec(message);
  return match ? match[0] : null;
}

function mapAdminRpcError(error: { message: string }): Error {
  const code = rpcErrorCode(error.message || '');

  switch (code) {
    case 'ERR_PAYMENT_INPUT':
      return new ValidationError('Datos inválidos');
    case 'ERR_PAYMENT_NOT_FOUND':
    case 'ERR_PAYMENT_AGENCY_MISMATCH':
    case 'ERR_PAYMENT_NOT_MARKETPLACE':
      return new NotFoundError('Pago no encontrado');
    case 'ERR_PAYMENT_RESERVATION_NOT_FOUND':
      return new NotFoundError('Reserva no encontrada');
    case 'ERR_PAYMENT_ADMIN_NOT_FOUND':
    case 'ERR_PAYMENT_ADMIN_ROLE':
    case 'ERR_PAYMENT_ADMIN_AGENCY':
      return new ForbiddenError('No autorizado');
    case 'ERR_PAYMENT_ALREADY_REJECTED':
      return new ConflictError('Este pago ya fue rechazado');
    case 'ERR_PAYMENT_VERIFIED_NO_REJECT':
      return new ConflictError('Un pago verificado no puede ser rechazado');
    case 'ERR_PAYMENT_NOT_PENDING':
      return new ConflictError('El pago ya no está pendiente de revisión');
    case 'ERR_PAYMENT_RESERVATION_STATE':
      return new ConflictError(
        'La reserva no está en un estado compatible con esta operación',
      );
    case 'ERR_PAYMENT_REJECT_REASON':
      return new ValidationError('El motivo de rechazo es obligatorio (1-500 caracteres)');
    case 'ERR_PAYMENT_VERIFY_NO_PASSENGERS':
    case 'ERR_PAYMENT_VERIFY_PRICE':
    case 'ERR_PAYMENT_VERIFY_SEATS':
    case 'ERR_PAYMENT_VERIFY_AMOUNT':
    case 'ERR_PAYMENT_VERIFY_SEAT_TRIP':
    case 'ERR_PAYMENT_VERIFY_SEAT_STATE':
    case 'ERR_PAYMENT_VERIFY_SEAT_MISSING':
    case 'ERR_PAYMENT_VERIFY_ALLOCATIONS':
    case 'ERR_PAYMENT_VERIFY_ALLOC_COUNT':
      return new UnprocessableError(
        'No se pudo verificar el pago: los datos de la reserva no son consistentes',
        'PAYMENT_VERIFY_INCONSISTENT',
      );
    case 'ERR_PAYMENT_VERIFY_RACE':
    case 'ERR_PAYMENT_VERIFY_RESERVATION':
    case 'ERR_PAYMENT_REJECT_RACE':
    case 'ERR_PAYMENT_REJECT_PASSENGERS':
    case 'ERR_PAYMENT_REJECT_RESERVATION':
      return new ConflictError(
        'El estado del pago cambió durante la operación. Intenta de nuevo',
      );
    default:
      return new AppError(
        'No se pudo procesar la operación. Intenta de nuevo',
        500,
        'PAYMENT_ADMIN_ERROR',
      );
  }
}

const UUID_DIR_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Comprueba que `payments.proof_url` viva bajo un directorio UUID válido:
 *
 *  - `<reservation_id>/<sha256>.<ext>` — flujo 083 (MKT-005), donde la
 *    reserva ya existía antes del comprobante.
 *  - `<attempt_id>/<sha256>.<ext>` — flujo MKT-007, donde la reserva
 *    recién nace al aprobar el intento y el archivo se subió contra el
 *    `checkout_attempt`.
 *
 * En ambos casos: sin subcarpetas, sin ".." y con extensión. La ruta
 * jamás llega del cliente (se lee de la fila de pago), pero igual se
 * valida aquí como defensa en profundidad frente a una fila corrupta.
 */
async function proofPathBelongsToPayment(
  proofPath: string,
  reservationId: string,
): Promise<boolean> {
  const separator = proofPath.indexOf('/');
  if (separator <= 0 || separator === proofPath.length - 1) return false;

  const dir = proofPath.slice(0, separator);
  const filename = proofPath.slice(separator + 1);

  if (filename.includes('/') || filename.includes('..')) return false;
  if (!/\.[a-z0-9]+$/i.test(filename)) return false;
  if (!UUID_DIR_RE.test(dir)) return false;
  if (dir === reservationId) return true;

  // MKT-007: el comprobante se subió contra un checkout_attempt. Solo
  // un intento VERIFICADO genera pagos, y su id es exactamente el
  // directorio, así que basta confirmar que esa fila existe y que su
  // proof_path sigue apuntando al mismo objeto.
  const { data, error } = await supabaseAdmin
    .from('checkout_attempts')
    .select('id, proof_path, status')
    .eq('id', dir)
    .maybeSingle();

  if (error || !data) return false;
  const attempt = data as { proof_path: string | null; status: string };
  return attempt.status === 'verified' && attempt.proof_path === proofPath;
}

export class PaymentService {
  async listAgencyPayments(
    input: ListAgencyPaymentsInput,
  ): Promise<ListAgencyPaymentsResult> {
    const from = (input.page - 1) * input.limit;
    const to = from + input.limit - 1;

    let query = supabaseAdmin
      .from('payments')
      .select(LIST_SELECT, { count: 'exact' })
      .eq('agency_id', input.agencyId)
      .order('status', { ascending: true })
      .order('submitted_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    if (input.status) {
      query = query.eq('status', input.status);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new AppError(
        'No se pudo listar los pagos. Intenta de nuevo',
        500,
        'PAYMENT_LIST_ERROR',
      );
    }

    return {
      payments: ((data ?? []) as unknown as PaymentListRow[]).map(mapListItem),
      page: input.page,
      limit: input.limit,
      total: count ?? 0,
    };
  }

  async getAgencyPaymentDetail(input: {
    paymentId: string;
    agencyId: string;
  }): Promise<AgencyPaymentDetail> {
    const { data, error } = await supabaseAdmin
      .from('payments')
      .select(DETAIL_SELECT)
      .eq('id', input.paymentId)
      .eq('agency_id', input.agencyId)
      .maybeSingle();

    if (error) {
      throw new AppError(
        'No se pudo cargar el pago. Intenta de nuevo',
        500,
        'PAYMENT_DETAIL_ERROR',
      );
    }

    if (!data) {
      throw new NotFoundError('Pago no encontrado');
    }

    const row = data as unknown as PaymentDetailRow;
    const reservation = normalizeReservation(row.reservations);
    const trip = normalizeTrip(reservation?.trips);
    const route = normalizeRoute(trip?.routes);
    const reservationId = reservation?.id ?? row.reservation_id;

    const [passengersResult, allocationsResult] = await Promise.all([
      supabaseAdmin
        .from('reservation_passengers')
        .select('id, seat_id, name, unit_price, status, seats ( seat_code )')
        .eq('reservation_id', reservationId)
        .order('seat_id'),
      supabaseAdmin
        .from('payment_allocations')
        .select(
          'id, reservation_passenger_id, amount_cents, created_at, reservation_passengers ( seat_id, seats ( seat_code ) )',
        )
        .eq('payment_id', row.id)
        .order('created_at'),
    ]);

    if (passengersResult.error || allocationsResult.error) {
      throw new AppError(
        'No se pudo cargar el pago. Intenta de nuevo',
        500,
        'PAYMENT_DETAIL_ERROR',
      );
    }

    type PassengerRow = {
      id: string;
      seat_id: string;
      name: string;
      unit_price: number | null;
      status: string;
      seats: unknown;
    };

    type AllocationRow = {
      id: string;
      reservation_passenger_id: string;
      amount_cents: number;
      created_at: string;
      reservation_passengers: unknown;
    };

    const passengers = ((passengersResult.data ?? []) as unknown as PassengerRow[]).map(
      (p) => ({
        id: p.id,
        seat_code:
          firstOrNull<{ seat_code: string }>(
            p.seats as { seat_code: string } | { seat_code: string }[] | null,
          )?.seat_code ?? null,
        name: p.name,
        unit_price: p.unit_price,
        status: p.status,
      }),
    );

    const allocations = ((allocationsResult.data ?? []) as unknown as AllocationRow[]).map(
      (a) => {
        const rp = firstOrNull<{ seats: unknown }>(
          a.reservation_passengers as
            | { seats: unknown }
            | { seats: unknown }[]
            | null,
        );
        const seat = firstOrNull<{ seat_code: string }>(
          rp?.seats as { seat_code: string } | { seat_code: string }[] | null,
        );
        return {
          id: a.id,
          reservation_passenger_id: a.reservation_passenger_id,
          seat_code: seat?.seat_code ?? null,
          amount_cents: a.amount_cents,
          created_at: a.created_at,
        };
      },
    );

    const activePassengers = passengers.filter((p) => p.status === 'active');
    const expectedCents = activePassengers.reduce(
      (sum, p) => sum + (p.unit_price ?? 0),
      0,
    );
    const allocatedCents = allocations.reduce(
      (sum, a) => sum + a.amount_cents,
      0,
    );

    return {
      payment: {
        id: row.id,
        status: row.status,
        amount_cents: row.amount_cents,
        currency: row.currency,
        submitted_at: row.submitted_at,
        verified_at: row.verified_at,
        verified_by: row.verified_by,
        rejection_reason: row.rejection_reason,
        has_proof: Boolean(row.proof_url),
      },
      reservation: {
        id: reservation?.id ?? row.reservation_id,
        booker_name: reservation?.booker_name ?? '',
        booker_phone: reservation?.booker_phone ?? null,
        contact_email: reservation?.contact_email ?? null,
        status: reservation?.status ?? '',
        payment_status: reservation?.payment_status ?? null,
        created_at: reservation?.created_at ?? row.submitted_at,
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
      allocations,
      totals: {
        active_passenger_count: activePassengers.length,
        expected_cents: expectedCents,
        allocated_cents: allocatedCents,
        remaining_cents: expectedCents - allocatedCents,
      },
    };
  }

  async getPaymentProofSignedUrl(input: {
    paymentId: string;
    agencyId: string;
  }): Promise<PaymentProofSignedUrlResult> {
    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('id, reservation_id, proof_url')
      .eq('id', input.paymentId)
      .eq('agency_id', input.agencyId)
      .maybeSingle();

    if (error) {
      throw new AppError(
        'No se pudo cargar el comprobante. Intenta de nuevo',
        500,
        'PAYMENT_PROOF_ERROR',
      );
    }

    if (!data) {
      throw new NotFoundError('Pago no encontrado');
    }

    const proofPath = (data as { proof_url: string | null }).proof_url;
    const reservationId = (data as { reservation_id: string }).reservation_id;

    if (!proofPath) {
      throw new NotFoundError('Este pago no tiene comprobante adjunto');
    }

    if (!(await proofPathBelongsToPayment(proofPath, reservationId))) {
      throw new NotFoundError('Este pago no tiene comprobante adjunto');
    }

    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(PROOF_BUCKET)
      .createSignedUrl(proofPath, PROOF_SIGNED_URL_TTL_SECONDS);

    if (signError || !signed?.signedUrl) {
      throw new AppError(
        'No se pudo generar el enlace del comprobante. Intenta de nuevo',
        500,
        'PAYMENT_STORAGE_ERROR',
      );
    }

    return {
      url: signed.signedUrl,
      expires_in_seconds: PROOF_SIGNED_URL_TTL_SECONDS,
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const { data, error } = await supabaseAdmin.rpc('verify_marketplace_payment', {
      p_payment_id: input.paymentId,
      p_actor_user_id: input.actorUserId,
    });

    if (error) {
      throw mapAdminRpcError(error);
    }

    const row = data as VerifyPaymentResult | null;
    if (!row?.payment_id) {
      throw new AppError(
        'No se pudo verificar el pago. Intenta de nuevo',
        500,
        'PAYMENT_ADMIN_ERROR',
      );
    }

    return row;
  }

  async rejectPayment(input: RejectPaymentInput): Promise<RejectPaymentResult> {
    const { data, error } = await supabaseAdmin.rpc('reject_marketplace_payment', {
      p_payment_id: input.paymentId,
      p_actor_user_id: input.actorUserId,
      p_reason: input.reason,
    });

    if (error) {
      throw mapAdminRpcError(error);
    }

    const row = data as RejectPaymentResult | null;
    if (!row?.payment_id) {
      throw new AppError(
        'No se pudo rechazar el pago. Intenta de nuevo',
        500,
        'PAYMENT_ADMIN_ERROR',
      );
    }

    return row;
  }
}

export const paymentService = new PaymentService();
