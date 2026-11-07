/**
 * PAY-NOTIFICATIONS Task 7 — integración de `notifyCustomerPaymentStatus`
 * en `CheckoutAttemptService.verify()` / `.reject()`.
 *
 * Cubre:
 *   - verify → notificación `payment_verified` con el customerId del
 *     envelope server-side y el `reservation_id` REAL del RPC, emitida
 *     DESPUÉS del éxito;
 *   - reject → notificación `payment_rejected` con customerId + attemptId;
 *   - desenlaces idempotentes (already_verified / already_rejected) →
 *     también se emite (el dedupe por clave natural vive en Task 6);
 *   - fallo de RPC o payload inválido → SIN notificación;
 *   - customerId / reservationId ausentes → se pasan tal cual (Task 6
 *     falla seguro) y la respuesta NO cambia;
 *   - fallo de la notificación (status failed o throw) → la operación
 *     de pago responde intacta, con log;
 *   - el outcome sigue siendo exactamente { result, customerId }: nada
 *     de notificaciones ni datos nuevos hacia el HTTP (req 6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notifyMock = vi.fn();

vi.mock('./customer-payment-notification.service.js', () => ({
  notifyCustomerPaymentStatus: (...args: unknown[]) => notifyMock(...args),
}));

type ChainResult = {
  data: unknown;
  error: { message: string } | null;
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

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const RESERVATION_ID = '44444444-4444-4444-8444-444444444444';

const VERIFY_OK = {
  attempt_id: ATTEMPT_ID,
  status: 'verified',
  already_verified: false,
  reservation_id: RESERVATION_ID,
  payment_id: '55555555-5555-4555-8555-555555555555',
  amount_cents: 120000,
  currency: 'COP',
  verified_at: '2026-11-04T10:00:00.000Z',
};

const VERIFY_IDEMPOTENT = { ...VERIFY_OK, already_verified: true };

const REJECT_OK = {
  attempt_id: ATTEMPT_ID,
  status: 'rejected',
  already_rejected: false,
  final: false,
  proof_count: 1,
  remaining_submissions: 2,
  rejection_reason: 'El comprobante no coincide con el monto',
  freed_seats: 0,
};

const REJECT_IDEMPOTENT = { ...REJECT_OK, already_rejected: true };

function stubCustomerLookup(result: ChainResult) {
  tableChains['checkout_attempts'] = createAttemptChain(result);
  return tableChains['checkout_attempts'];
}

function verify() {
  return checkoutAttemptService.verify({
    attemptId: ATTEMPT_ID,
    actorUserId: ACTOR_ID,
  });
}

function reject() {
  return checkoutAttemptService.reject({
    attemptId: ATTEMPT_ID,
    actorUserId: ACTOR_ID,
    reason: 'El comprobante no coincide con el monto',
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
  notifyMock.mockResolvedValue({ status: 'inserted' });
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('CheckoutAttemptService → notificación al cliente (Task 7)', () => {
  it('verify emite payment_verified con el contexto del envelope y la reserva REAL del RPC', async () => {
    mockRpc.mockResolvedValue({ data: VERIFY_OK, error: null });
    stubCustomerLookup({ data: { customer_id: CUSTOMER_ID }, error: null });

    const outcome = await verify();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({
      type: 'payment_verified',
      customerId: CUSTOMER_ID,
      attemptId: ATTEMPT_ID,
      reservationId: RESERVATION_ID,
    });

    // Después del éxito de la RPC (la notificación no corre antes).
    expect(notifyMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockRpc.mock.invocationCallOrder[0],
    );

    // Outcome intacto: exactamente { result, customerId } — sin campos
    // de notificación que pudieran filtrarse al HTTP (req 6).
    expect(outcome).toEqual({ result: VERIFY_OK, customerId: CUSTOMER_ID });
    expect(Object.keys(outcome).sort()).toEqual(['customerId', 'result']);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('reject emite payment_rejected con el customerId del envelope y el attempt', async () => {
    mockRpc.mockResolvedValue({ data: REJECT_OK, error: null });
    stubCustomerLookup({ data: { customer_id: CUSTOMER_ID }, error: null });

    const outcome = await reject();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    // Igualdad exacta: sin reservationId (el rechazo no tiene reserva).
    expect(notifyMock).toHaveBeenCalledWith({
      type: 'payment_rejected',
      customerId: CUSTOMER_ID,
      attemptId: ATTEMPT_ID,
    });
    expect(notifyMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockRpc.mock.invocationCallOrder[0],
    );

    expect(outcome).toEqual({ result: REJECT_OK, customerId: CUSTOMER_ID });
    expect(Object.keys(outcome).sort()).toEqual(['customerId', 'result']);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('resultado idempotente already_verified: también emite (el dedupe vive en Task 6)', async () => {
    mockRpc.mockResolvedValue({ data: VERIFY_IDEMPOTENT, error: null });
    stubCustomerLookup({ data: { customer_id: CUSTOMER_ID }, error: null });

    const outcome = await verify();

    expect(outcome.result.already_verified).toBe(true);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({
      type: 'payment_verified',
      customerId: CUSTOMER_ID,
      attemptId: ATTEMPT_ID,
      reservationId: RESERVATION_ID,
    });
  });

  it('resultado idempotente already_rejected: también emite con el mismo contexto', async () => {
    mockRpc.mockResolvedValue({ data: REJECT_IDEMPOTENT, error: null });
    stubCustomerLookup({ data: { customer_id: CUSTOMER_ID }, error: null });

    const outcome = await reject();

    expect(outcome.result.already_rejected).toBe(true);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({
      type: 'payment_rejected',
      customerId: CUSTOMER_ID,
      attemptId: ATTEMPT_ID,
    });
  });

  it('fallo de RPC o payload inválido: SIN notificación (verify y reject)', async () => {
    // RPC con error → se lanza antes de cualquier emisión.
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'ERR_CHECKOUT_ATTEMPT_NOT_FOUND: Checkout attempt not found' },
    });
    await expect(verify()).rejects.toThrow('Compra no encontrada');
    expect(notifyMock).not.toHaveBeenCalled();

    await expect(reject()).rejects.toThrow();
    expect(notifyMock).not.toHaveBeenCalled();

    // Payload sin attempt_id → error 500, tampoco se emite.
    mockRpc.mockResolvedValue({ data: {}, error: null });
    await expect(verify()).rejects.toMatchObject({
      code: 'CHECKOUT_VERIFY_ERROR',
    });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('customerId ausente (lookup falló): se pasa null, Task 6 falla seguro y la respuesta no cambia', async () => {
    mockRpc.mockResolvedValue({ data: VERIFY_OK, error: null });
    stubCustomerLookup({ data: null, error: { message: 'connection reset' } });

    const outcome = await verify();

    expect(outcome.customerId).toBeNull();
    expect(outcome.result).toEqual(VERIFY_OK);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({
      type: 'payment_verified',
      customerId: null,
      attemptId: ATTEMPT_ID,
      reservationId: RESERVATION_ID,
    });
    // La lookup sigue registrando su fallo (comportamiento Task 2 intacto).
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"CHECKOUT_CUSTOMER_ID_LOOKUP_FAILED"'),
    );
  });

  it('reservationId ausente (RPC lo devolvió null): se pasa null y la respuesta no cambia', async () => {
    mockRpc.mockResolvedValue({
      data: { ...VERIFY_OK, reservation_id: null },
      error: null,
    });
    stubCustomerLookup({ data: { customer_id: CUSTOMER_ID }, error: null });

    const outcome = await verify();

    expect(outcome.result.reservation_id).toBeNull();
    expect(outcome.customerId).toBe(CUSTOMER_ID);
    expect(notifyMock).toHaveBeenCalledWith({
      type: 'payment_verified',
      customerId: CUSTOMER_ID,
      attemptId: ATTEMPT_ID,
      reservationId: null,
    });
  });

  it('la notificación responde failed: la operación de pago queda intacta', async () => {
    notifyMock.mockResolvedValue({ status: 'failed' });
    mockRpc.mockResolvedValue({ data: VERIFY_OK, error: null });
    stubCustomerLookup({ data: { customer_id: CUSTOMER_ID }, error: null });

    const outcome = await verify();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ result: VERIFY_OK, customerId: CUSTOMER_ID });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('la notificación LANZA (regresión en Task 6): verify responde intacta con log', async () => {
    notifyMock.mockRejectedValue(new Error('db down'));
    mockRpc.mockResolvedValue({ data: VERIFY_OK, error: null });
    stubCustomerLookup({ data: { customer_id: CUSTOMER_ID }, error: null });

    const outcome = await verify();

    expect(outcome).toEqual({ result: VERIFY_OK, customerId: CUSTOMER_ID });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"CHECKOUT_CUSTOMER_NOTIFICATION_FAILED"'),
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('la notificación LANZA: reject responde intacta con log', async () => {
    notifyMock.mockRejectedValue(new Error('db down'));
    mockRpc.mockResolvedValue({ data: REJECT_OK, error: null });
    stubCustomerLookup({ data: { customer_id: CUSTOMER_ID }, error: null });

    const outcome = await reject();

    expect(outcome).toEqual({ result: REJECT_OK, customerId: CUSTOMER_ID });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"CHECKOUT_CUSTOMER_NOTIFICATION_FAILED"'),
    );
  });
});
