/**
 * PAY-NOTIFICATIONS Task 2 — obtención server-side del customer_id
 * después de aprobar / rechazar un checkout attempt.
 *
 * Bloquea:
 *   - el customer_id se lee del intento (attempt id) DESPUÉS del RPC
 *     exitoso y nunca llega del input del cliente;
 *   - la rama idempotente (already_verified / already_rejected) también
 *     lo resuelve;
 *   - ownership: si el RPC rechaza (agency mismatch / not found) NO se
 *     consulta ningún customer_id;
 *   - missing-data y errores de lectura: la aprobación/rechazo no fallan
 *     (customer_id queda null, best-effort);
 *   - el contrato del RPC sigue intacto (mismos argumentos, mismo
 *     `result`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, NotFoundError } from '../errors/index.js';

type ChainResult = {
  data: unknown;
  error: { message: string } | null;
};

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';

const VERIFY_OK = {
  attempt_id: ATTEMPT_ID,
  status: 'verified',
  already_verified: false,
  reservation_id: '44444444-4444-4444-8444-444444444444',
  payment_id: '55555555-5555-4555-8555-555555555555',
  amount_cents: 120000,
  currency: 'COP',
  proof_count: 1,
  allocation_count: 2,
  passenger_count: 2,
  verified_at: '2026-11-04T10:00:00.000Z',
  verified_by: ACTOR_ID,
  payment_status: 'fully_paid',
  audit_id: '66666666-6666-4666-8666-666666666666',
  reservation_audit_id: '77777777-7777-4777-8777-777777777777',
};

const REJECT_OK = {
  attempt_id: ATTEMPT_ID,
  status: 'rejected',
  already_rejected: false,
  final: false,
  proof_count: 1,
  remaining_submissions: 2,
  rejection_reason: 'El comprobante no coincide con el monto',
  freed_seats: 0,
  audit_id: '88888888-8888-4888-8888-888888888888',
};

function createAttemptChain(result: ChainResult) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  return chain;
}

const tableChains: Record<string, ReturnType<typeof createAttemptChain>> = {};

const mockFrom = vi.fn((table: string) => {
  if (!tableChains[table]) {
    tableChains[table] = createAttemptChain({ data: null, error: null });
  }
  return tableChains[table];
});

const mockRpc = vi.fn();

vi.mock('../config/database.js', () => ({
  supabaseAdmin: {
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { checkoutAttemptService } from './checkout-attempt.service.js';

function stubAttemptLookup(result: ChainResult) {
  tableChains['checkout_attempts'] = createAttemptChain(result);
  return tableChains['checkout_attempts'];
}

function lookupChain() {
  const chain = tableChains['checkout_attempts'];
  if (!chain) throw new Error('lookup de checkout_attempts no stubbeado');
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('CheckoutAttemptService.verify — customer_id (Task 2)', () => {
  it('resuelve el customer_id server-side después del RPC, sin recibirlo del cliente', async () => {
    mockRpc.mockResolvedValue({ data: VERIFY_OK, error: null });
    const chain = stubAttemptLookup({
      data: { customer_id: CUSTOMER_ID },
      error: null,
    });

    const outcome = await checkoutAttemptService.verify({
      attemptId: ATTEMPT_ID,
      actorUserId: ACTOR_ID,
    });

    // Contrato del RPC intacto.
    expect(mockRpc).toHaveBeenCalledWith('verify_checkout_attempt', {
      p_attempt_id: ATTEMPT_ID,
      p_actor_user_id: ACTOR_ID,
    });
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('customer_id');
    expect(outcome.result).toEqual(VERIFY_OK);
    expect(outcome.result).not.toHaveProperty('customer_id');

    // Lectura server-side: solo por attempt id.
    expect(mockFrom).toHaveBeenCalledWith('checkout_attempts');
    expect(chain.select).toHaveBeenCalledWith('customer_id');
    expect(chain.eq).toHaveBeenCalledWith('id', ATTEMPT_ID);
    expect(outcome.customerId).toBe(CUSTOMER_ID);
  });

  it('resuelve el customer_id también en la rama idempotente (already_verified)', async () => {
    mockRpc.mockResolvedValue({
      data: { ...VERIFY_OK, already_verified: true },
      error: null,
    });
    stubAttemptLookup({ data: { customer_id: CUSTOMER_ID }, error: null });

    const outcome = await checkoutAttemptService.verify({
      attemptId: ATTEMPT_ID,
      actorUserId: ACTOR_ID,
    });

    expect(outcome.result.already_verified).toBe(true);
    expect(outcome.customerId).toBe(CUSTOMER_ID);
  });

  it('si la fila del intento ya no existe, devuelve customerId null sin fallar la aprobación', async () => {
    mockRpc.mockResolvedValue({ data: VERIFY_OK, error: null });
    stubAttemptLookup({ data: null, error: null });

    const outcome = await checkoutAttemptService.verify({
      attemptId: ATTEMPT_ID,
      actorUserId: ACTOR_ID,
    });

    expect(outcome.customerId).toBeNull();
    expect(outcome.result.status).toBe('verified');
  });

  it('si la lectura falla, no falla la operación y deja constancia en logs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockResolvedValue({ data: VERIFY_OK, error: null });
    stubAttemptLookup({ data: null, error: { message: 'connection reset' } });

    const outcome = await checkoutAttemptService.verify({
      attemptId: ATTEMPT_ID,
      actorUserId: ACTOR_ID,
    });

    expect(outcome.customerId).toBeNull();
    expect(outcome.result.status).toBe('verified');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CHECKOUT_CUSTOMER_ID_LOOKUP_FAILED'),
    );
    errorSpy.mockRestore();
  });

  it('ownership: si el RPC rechaza por agencia, no se lee ningún customer_id', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message:
          'ERR_CHECKOUT_AGENCY_MISMATCH: Checkout attempt does not belong to this agency',
      },
    });

    await expect(
      checkoutAttemptService.verify({
        attemptId: ATTEMPT_ID,
        actorUserId: ACTOR_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('si el RPC responde sin attempt_id, falla sin consultar el intento', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'verified' }, error: null });

    await expect(
      checkoutAttemptService.verify({
        attemptId: ATTEMPT_ID,
        actorUserId: ACTOR_ID,
      }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_VERIFY_ERROR' });

    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('CheckoutAttemptService.reject — customer_id (Task 2)', () => {
  it('resuelve el customer_id server-side después del RPC, sin recibirlo del cliente', async () => {
    mockRpc.mockResolvedValue({ data: REJECT_OK, error: null });
    const chain = stubAttemptLookup({
      data: { customer_id: CUSTOMER_ID },
      error: null,
    });

    const outcome = await checkoutAttemptService.reject({
      attemptId: ATTEMPT_ID,
      actorUserId: ACTOR_ID,
      reason: 'El comprobante no coincide con el monto',
    });

    expect(mockRpc).toHaveBeenCalledWith('reject_checkout_attempt', {
      p_attempt_id: ATTEMPT_ID,
      p_actor_user_id: ACTOR_ID,
      p_reason: 'El comprobante no coincide con el monto',
    });
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('customer_id');
    expect(outcome.result).toEqual(REJECT_OK);
    expect(outcome.result).not.toHaveProperty('customer_id');

    expect(mockFrom).toHaveBeenCalledWith('checkout_attempts');
    expect(chain.select).toHaveBeenCalledWith('customer_id');
    expect(chain.eq).toHaveBeenCalledWith('id', ATTEMPT_ID);
    expect(outcome.customerId).toBe(CUSTOMER_ID);
  });

  it('resuelve el customer_id también en la rama idempotente (already_rejected)', async () => {
    mockRpc.mockResolvedValue({
      data: { ...REJECT_OK, already_rejected: true },
      error: null,
    });
    stubAttemptLookup({ data: { customer_id: CUSTOMER_ID }, error: null });

    const outcome = await checkoutAttemptService.reject({
      attemptId: ATTEMPT_ID,
      actorUserId: ACTOR_ID,
      reason: 'Motivo',
    });

    expect(outcome.result.already_rejected).toBe(true);
    expect(outcome.customerId).toBe(CUSTOMER_ID);
  });

  it('si la fila del intento ya no existe, devuelve customerId null sin fallar el rechazo', async () => {
    mockRpc.mockResolvedValue({ data: REJECT_OK, error: null });
    stubAttemptLookup({ data: null, error: null });

    const outcome = await checkoutAttemptService.reject({
      attemptId: ATTEMPT_ID,
      actorUserId: ACTOR_ID,
      reason: 'Motivo',
    });

    expect(outcome.customerId).toBeNull();
    expect(outcome.result.status).toBe('rejected');
  });

  it('si la lectura falla, no falla el rechazo y deja constancia en logs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockResolvedValue({ data: REJECT_OK, error: null });
    stubAttemptLookup({ data: null, error: { message: 'timeout' } });

    const outcome = await checkoutAttemptService.reject({
      attemptId: ATTEMPT_ID,
      actorUserId: ACTOR_ID,
      reason: 'Motivo',
    });

    expect(outcome.customerId).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CHECKOUT_CUSTOMER_ID_LOOKUP_FAILED'),
    );
    errorSpy.mockRestore();
  });

  it('ownership: si el intento no existe, no se lee ningún customer_id', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'ERR_CHECKOUT_ATTEMPT_NOT_FOUND: Checkout attempt not found' },
    });

    await expect(
      checkoutAttemptService.reject({
        attemptId: ATTEMPT_ID,
        actorUserId: ACTOR_ID,
        reason: 'Motivo',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('propaga errores del RPC sin intentar resolver el customer_id', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'ERR_CHECKOUT_REJECT_REASON: reason must be 1-500 characters' },
    });

    await expect(
      checkoutAttemptService.reject({
        attemptId: ATTEMPT_ID,
        actorUserId: ACTOR_ID,
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(mockFrom).not.toHaveBeenCalled();
  });
});
