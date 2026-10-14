import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from '../errors/index.js';

type ChainResult = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

function createChainable(result: ChainResult = { data: [], error: null }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.order = vi.fn(self);
  chain.range = vi.fn(self);
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: result.data, error: result.error }),
  );
  chain.then = (
    resolve: (v: ChainResult) => void,
    reject?: (e: unknown) => void,
  ) => {
    Promise.resolve(result).then(resolve, reject);
  };
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    range: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: (
      resolve: (v: ChainResult) => void,
      reject?: (e: unknown) => void,
    ) => void;
  };
}

const tableChains: Record<string, ReturnType<typeof createChainable>> = {};

const mockFrom = vi.fn((table: string) => {
  if (!tableChains[table]) {
    tableChains[table] = createChainable();
  }
  return tableChains[table];
});

const mockRpc = vi.fn();
const mockCreateSignedUrl = vi.fn();
const mockStorageFrom = vi.fn(() => ({ createSignedUrl: mockCreateSignedUrl }));

vi.mock('../config/database.js', () => ({
  supabaseAdmin: {
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: { from: (...args: unknown[]) => mockStorageFrom(...args) },
  },
}));

import {
  paymentService,
  PROOF_SIGNED_URL_TTL_SECONDS,
} from './payment.service.js';

const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PAYMENT_1 = '99999999-9999-4999-8999-999999999999';
const RESERVATION_1 = '77777777-7777-4777-8777-777777777777';
const TRIP_1 = '11111111-1111-4111-8111-111111111111';
const ACTOR_1 = '33333333-3333-4333-8333-333333333333';
const PASSENGER_1 = '55555555-5555-4555-8555-555555555555';
const PASSENGER_2 = '55555555-5555-4555-8555-555555555556';
const ALLOCATION_1 = '66666666-6666-4666-8666-666666666666';
const T1 = '2026-08-15T12:00:00.000Z';
const T2 = '2026-08-15T10:00:00.000Z';

function listRow(partial: Partial<Record<string, unknown>> = {}) {
  return {
    id: PAYMENT_1,
    status: 'pending',
    amount_cents: 60000,
    currency: 'COP',
    submitted_at: T1,
    verified_at: null,
    rejection_reason: null,
    proof_url: `${RESERVATION_1}/abc.png`,
    reservation_id: RESERVATION_1,
    reservations: [
      {
        id: RESERVATION_1,
        booker_name: 'Ana Lopez',
        contact_email: 'ana@example.com',
        status: 'reserved',
        payment_status: 'pending',
        trips: [
          {
            id: TRIP_1,
            departure_time: T2,
            routes: [{ origin: 'Caracas', destination: 'Maracaibo' }],
          },
        ],
      },
    ],
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('PaymentService.listAgencyPayments', () => {
  it('scopes to agency, orders pending first, paginates, and omits proof_url', async () => {
    tableChains['payments'] = createChainable({
      data: [listRow()],
      error: null,
      count: 1,
    });

    const result = await paymentService.listAgencyPayments({
      agencyId: AGENCY_A,
      page: 1,
      limit: 20,
    });

    expect(mockFrom).toHaveBeenCalledWith('payments');
    const chain = tableChains['payments'];
    expect(chain.eq).toHaveBeenCalledWith('agency_id', AGENCY_A);
    expect(chain.order).toHaveBeenCalledWith('status', { ascending: true });
    expect(chain.order).toHaveBeenCalledWith('submitted_at', { ascending: false });
    expect(chain.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(chain.range).toHaveBeenCalledWith(0, 19);

    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.payments).toHaveLength(1);

    const item = result.payments[0];
    expect(item.id).toBe(PAYMENT_1);
    expect(item.has_proof).toBe(true);
    expect(item.reservation.trip).toEqual({
      id: TRIP_1,
      departure_time: T2,
      origin: 'Caracas',
      destination: 'Maracaibo',
    });
    expect(JSON.stringify(result)).not.toContain('proof_url');
    expect(JSON.stringify(result)).not.toContain(RESERVATION_1 + '/');
  });

  it('applies the optional status filter', async () => {
    tableChains['payments'] = createChainable({ data: [], error: null, count: 0 });

    await paymentService.listAgencyPayments({
      agencyId: AGENCY_A,
      status: 'verified',
      page: 2,
      limit: 10,
    });

    const chain = tableChains['payments'];
    expect(chain.eq).toHaveBeenCalledWith('status', 'verified');
    expect(chain.range).toHaveBeenCalledWith(10, 19);
  });

  it('maps has_proof=false when proof_url is null', async () => {
    tableChains['payments'] = createChainable({
      data: [listRow({ proof_url: null })],
      error: null,
      count: 1,
    });

    const result = await paymentService.listAgencyPayments({
      agencyId: AGENCY_A,
      page: 1,
      limit: 20,
    });

    expect(result.payments[0].has_proof).toBe(false);
  });

  it('resuelve checkout_attempt_id desde idempotency_key MKT-007', async () => {
    const ATTEMPT_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    tableChains['payments'] = createChainable({
      data: [listRow({ idempotency_key: `mkt007:${ATTEMPT_1}:verify` })],
      error: null,
      count: 1,
    });

    const result = await paymentService.listAgencyPayments({
      agencyId: AGENCY_A,
      page: 1,
      limit: 20,
    });

    expect(result.payments[0].checkout_attempt_id).toBe(ATTEMPT_1);
  });

  it('deja checkout_attempt_id en null para pagos legacy sin intento', async () => {
    tableChains['payments'] = createChainable({
      data: [listRow({ idempotency_key: null })],
      error: null,
      count: 1,
    });

    const result = await paymentService.listAgencyPayments({
      agencyId: AGENCY_A,
      page: 1,
      limit: 20,
    });

    expect(result.payments[0].checkout_attempt_id).toBeNull();
  });

  it('throws PAYMENT_LIST_ERROR on database error', async () => {
    tableChains['payments'] = createChainable({
      data: null,
      error: { message: 'boom' },
    });

    await expect(
      paymentService.listAgencyPayments({ agencyId: AGENCY_A, page: 1, limit: 20 }),
    ).rejects.toMatchObject({ code: 'PAYMENT_LIST_ERROR', statusCode: 500 });
  });
});

describe('PaymentService.getAgencyPaymentDetail', () => {
  function detailRow() {
    return {
      id: PAYMENT_1,
      status: 'verified',
      amount_cents: 60000,
      currency: 'COP',
      submitted_at: T1,
      verified_at: T2,
      verified_by: ACTOR_1,
      rejection_reason: null,
      proof_url: `${RESERVATION_1}/abc.png`,
      reservation_id: RESERVATION_1,
      reservations: [
        {
          id: RESERVATION_1,
          booker_name: 'Ana Lopez',
          booker_phone: '04241234567',
          contact_email: 'ana@example.com',
          status: 'reserved',
          payment_status: 'fully_paid',
          created_at: T1,
          trips: [
            {
              id: TRIP_1,
              departure_time: T2,
              vehicle_type: 'kia',
              seat_price: 30000,
              routes: [{ origin: 'Caracas', destination: 'Maracaibo' }],
            },
          ],
        },
      ],
    };
  }

  it('returns 404 for a missing or foreign payment (same 404)', async () => {
    tableChains['payments'] = createChainable({ data: null, error: null });

    await expect(
      paymentService.getAgencyPaymentDetail({ paymentId: PAYMENT_1, agencyId: AGENCY_A }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(tableChains['payments'].eq).toHaveBeenCalledWith('id', PAYMENT_1);
    expect(tableChains['payments'].eq).toHaveBeenCalledWith('agency_id', AGENCY_A);
  });

  it('computes totals from active passengers and allocations', async () => {
    tableChains['payments'] = createChainable({ data: detailRow(), error: null });
    tableChains['reservation_passengers'] = createChainable({
      data: [
        {
          id: PASSENGER_1,
          seat_id: 'seat-1',
          name: 'Ana Lopez',
          unit_price: 30000,
          status: 'active',
          seats: [{ seat_code: 'A1' }],
        },
        {
          id: PASSENGER_2,
          seat_id: 'seat-2',
          name: 'Luis Perez',
          unit_price: 30000,
          status: 'active',
          seats: [{ seat_code: 'A2' }],
        },
      ],
      error: null,
    });
    tableChains['payment_allocations'] = createChainable({
      data: [
        {
          id: ALLOCATION_1,
          reservation_passenger_id: PASSENGER_1,
          amount_cents: 30000,
          created_at: T2,
          reservation_passengers: [
            { seat_id: 'seat-1', seats: [{ seat_code: 'A1' }] },
          ],
        },
      ],
      error: null,
    });

    const result = await paymentService.getAgencyPaymentDetail({
      paymentId: PAYMENT_1,
      agencyId: AGENCY_A,
    });

    expect(result.payment.has_proof).toBe(true);
    expect(result.trip).toEqual({
      id: TRIP_1,
      departure_time: T2,
      vehicle_type: 'kia',
      seat_price: 30000,
      origin: 'Caracas',
      destination: 'Maracaibo',
    });
    expect(result.passengers).toHaveLength(2);
    expect(result.passengers[0].seat_code).toBe('A1');
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].seat_code).toBe('A1');
    expect(result.totals).toEqual({
      active_passenger_count: 2,
      expected_cents: 60000,
      allocated_cents: 30000,
      remaining_cents: 30000,
    });
    expect(JSON.stringify(result)).not.toContain('proof_url');
    expect(JSON.stringify(result)).not.toContain(`${RESERVATION_1}/abc.png`);
  });

  it('throws PAYMENT_DETAIL_ERROR when passengers or allocations fail', async () => {
    tableChains['payments'] = createChainable({ data: detailRow(), error: null });
    tableChains['reservation_passengers'] = createChainable({
      data: null,
      error: { message: 'boom' },
    });
    tableChains['payment_allocations'] = createChainable({ data: [], error: null });

    await expect(
      paymentService.getAgencyPaymentDetail({ paymentId: PAYMENT_1, agencyId: AGENCY_A }),
    ).rejects.toMatchObject({ code: 'PAYMENT_DETAIL_ERROR', statusCode: 500 });
  });
});

describe('PaymentService.getPaymentProofSignedUrl', () => {
  it('returns 404 when the payment does not exist or belongs to another agency', async () => {
    tableChains['payments'] = createChainable({ data: null, error: null });

    await expect(
      paymentService.getPaymentProofSignedUrl({ paymentId: PAYMENT_1, agencyId: AGENCY_A }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it('returns 404 when the payment has no proof attached', async () => {
    tableChains['payments'] = createChainable({
      data: { id: PAYMENT_1, reservation_id: RESERVATION_1, proof_url: null },
      error: null,
    });

    await expect(
      paymentService.getPaymentProofSignedUrl({ paymentId: PAYMENT_1, agencyId: AGENCY_A }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['path outside reservation directory', `other/${'x'.repeat(8)}.png`],
    ['nested subfolder', `${RESERVATION_1}/sub/dir.png`],
    ['path traversal', `${RESERVATION_1}/../secret.png`],
    ['missing extension', `${RESERVATION_1}/noext`],
  ])('rejects invalid proof path (%s)', async (_label, proofPath) => {
    tableChains['payments'] = createChainable({
      data: { id: PAYMENT_1, reservation_id: RESERVATION_1, proof_url: proofPath },
      error: null,
    });

    await expect(
      paymentService.getPaymentProofSignedUrl({ paymentId: PAYMENT_1, agencyId: AGENCY_A }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it('signs a valid proof path with a 300s TTL', async () => {
    const proofPath = `${RESERVATION_1}/deadbeef.png`;
    tableChains['payments'] = createChainable({
      data: { id: PAYMENT_1, reservation_id: RESERVATION_1, proof_url: proofPath },
      error: null,
    });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.example/x' },
      error: null,
    });

    const result = await paymentService.getPaymentProofSignedUrl({
      paymentId: PAYMENT_1,
      agencyId: AGENCY_A,
    });

    expect(mockStorageFrom).toHaveBeenCalledWith('payment-proofs');
    expect(mockCreateSignedUrl).toHaveBeenCalledWith(proofPath, 300);
    expect(result).toEqual({
      url: 'https://signed.example/x',
      expires_in_seconds: PROOF_SIGNED_URL_TTL_SECONDS,
    });
  });

  it('throws PAYMENT_STORAGE_ERROR when signing fails', async () => {
    tableChains['payments'] = createChainable({
      data: {
        id: PAYMENT_1,
        reservation_id: RESERVATION_1,
        proof_url: `${RESERVATION_1}/deadbeef.png`,
      },
      error: null,
    });
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: 'nope' } });

    await expect(
      paymentService.getPaymentProofSignedUrl({ paymentId: PAYMENT_1, agencyId: AGENCY_A }),
    ).rejects.toMatchObject({ code: 'PAYMENT_STORAGE_ERROR', statusCode: 500 });
  });
});

describe('PaymentService.verifyPayment / rejectPayment', () => {
  const verifyRow = {
    payment_id: PAYMENT_1,
    reservation_id: RESERVATION_1,
    status: 'verified',
    already_verified: false,
    amount_cents: 60000,
    currency: 'COP',
    allocation_count: 2,
    total_expected_cents: 60000,
    verified_at: T1,
    verified_by: ACTOR_1,
    payment_status: 'fully_paid',
    audit_id: 'audit-1',
  };

  it('verify calls the RPC with payment + actor and returns the row', async () => {
    mockRpc.mockResolvedValue({ data: verifyRow, error: null });

    const result = await paymentService.verifyPayment({
      paymentId: PAYMENT_1,
      actorUserId: ACTOR_1,
    });

    expect(mockRpc).toHaveBeenCalledWith('verify_marketplace_payment', {
      p_payment_id: PAYMENT_1,
      p_actor_user_id: ACTOR_1,
    });
    expect(result).toEqual(verifyRow);
  });

  it('verify passes through already_verified idempotent results', async () => {
    mockRpc.mockResolvedValue({
      data: { ...verifyRow, already_verified: true, allocation_count: 0 },
      error: null,
    });

    const result = await paymentService.verifyPayment({
      paymentId: PAYMENT_1,
      actorUserId: ACTOR_1,
    });
    expect(result.already_verified).toBe(true);
  });

  it('reject calls the RPC with payment + actor + reason', async () => {
    const rejectRow = {
      payment_id: PAYMENT_1,
      reservation_id: RESERVATION_1,
      status: 'rejected',
      already_rejected: false,
      rejection_reason: 'Monto no coincide',
      outcome: 'cancelled_reservation',
      cancelled_reservation: true,
      reservation_status: 'cancelled',
      payment_status: 'cancelled',
      freed_seat_count: 2,
      cancelled_passenger_count: 2,
      refund_required: false,
      refund_amount_cents: 0,
      payment_audit_id: 'a1',
      reservation_audit_id: 'a2',
    };
    mockRpc.mockResolvedValue({ data: rejectRow, error: null });

    const result = await paymentService.rejectPayment({
      paymentId: PAYMENT_1,
      actorUserId: ACTOR_1,
      reason: 'Monto no coincide',
    });

    expect(mockRpc).toHaveBeenCalledWith('reject_marketplace_payment', {
      p_payment_id: PAYMENT_1,
      p_actor_user_id: ACTOR_1,
      p_reason: 'Monto no coincide',
    });
    expect(result).toEqual(rejectRow);
  });

  it.each([
    ['ERR_PAYMENT_NOT_FOUND', NotFoundError],
    ['ERR_PAYMENT_AGENCY_MISMATCH', NotFoundError],
    ['ERR_PAYMENT_NOT_MARKETPLACE', NotFoundError],
    ['ERR_PAYMENT_RESERVATION_NOT_FOUND', NotFoundError],
    ['ERR_PAYMENT_ADMIN_ROLE', ForbiddenError],
    ['ERR_PAYMENT_ADMIN_AGENCY', ForbiddenError],
    ['ERR_PAYMENT_ALREADY_REJECTED', ConflictError],
    ['ERR_PAYMENT_VERIFIED_NO_REJECT', ConflictError],
    ['ERR_PAYMENT_NOT_PENDING', ConflictError],
    ['ERR_PAYMENT_RESERVATION_STATE', ConflictError],
    ['ERR_PAYMENT_VERIFY_AMOUNT', UnprocessableError],
    ['ERR_PAYMENT_VERIFY_NO_PASSENGERS', UnprocessableError],
    ['ERR_PAYMENT_VERIFY_RACE', ConflictError],
    ['ERR_PAYMENT_REJECT_RACE', ConflictError],
    ['ERR_PAYMENT_REJECT_REASON', ValidationError],
    ['ERR_PAYMENT_INPUT', ValidationError],
    ['ERR_SOMETHING_ELSE', AppError],
  ])('maps %s to the right error class', async (code, expected) => {
    mockRpc.mockResolvedValue({ data: null, error: { message: `${code}: detail` } });

    await expect(
      paymentService.verifyPayment({ paymentId: PAYMENT_1, actorUserId: ACTOR_1 }),
    ).rejects.toBeInstanceOf(expected);
  });

  it('throws PAYMENT_ADMIN_ERROR when the RPC returns no payment_id', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'verified' }, error: null });

    await expect(
      paymentService.verifyPayment({ paymentId: PAYMENT_1, actorUserId: ACTOR_1 }),
    ).rejects.toMatchObject({ code: 'PAYMENT_ADMIN_ERROR', statusCode: 500 });
  });
});
