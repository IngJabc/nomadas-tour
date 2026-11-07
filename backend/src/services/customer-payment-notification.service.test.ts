/**
 * PAY-NOTIFICATIONS Task 6 — tests del servicio de notificaciones de
 * pago del cliente (`customer_notifications`).
 *
 * Cubre:
 *   - `payment_verified` y `payment_rejected` insertan la fila mínima
 *     con la entidad correcta y `action_url` real;
 *   - datos requeridos ausentes/inválidos → `failed` SIN tocar la BD;
 *   - duplicados (pre-check por clave natural) → `duplicate` sin INSERT;
 *   - fallos de BD (lookup, insert, red) → `failed` + log, NUNCA throw;
 *   - la fila solo contiene columnas que 098 define (sin campos de más).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  type QueryResult = {
    data?: unknown;
    error?: { message: string; code?: string } | null;
  };

  const state = {
    lookupQueue: [] as Array<QueryResult | Error>,
    lookupDefault: { data: null, error: null } as QueryResult,
    insertQueue: [] as Array<QueryResult | Error>,
    insertDefault: { data: null, error: null } as QueryResult,
    lookups: [] as Array<Array<[string, unknown]>>,
    inserts: [] as Array<Record<string, unknown>>,
  };

  function settle(result: QueryResult | Error): Promise<QueryResult> {
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(result);
  }

  function from(_table: string) {
    const filters: Array<[string, unknown]> = [];
    const chain: Record<string, unknown> = {};

    chain.select = () => chain;
    chain.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    };
    chain.maybeSingle = () => {
      state.lookups.push([...filters]);
      const next =
        state.lookupQueue.length > 0
          ? state.lookupQueue.shift()!
          : state.lookupDefault;
      return settle(next);
    };
    chain.insert = (row: Record<string, unknown>) => {
      state.inserts.push(row);
      const next =
        state.insertQueue.length > 0
          ? state.insertQueue.shift()!
          : state.insertDefault;
      return settle(next);
    };
    return chain;
  }

  return {
    from,
    pushLookup(result: QueryResult | Error) {
      state.lookupQueue.push(result);
    },
    pushInsert(result: QueryResult | Error) {
      state.insertQueue.push(result);
    },
    lookups: () => state.lookups,
    inserts: () => state.inserts,
    reset() {
      state.lookupQueue = [];
      state.insertQueue = [];
      state.lookupDefault = { data: null, error: null };
      state.insertDefault = { data: null, error: null };
      state.lookups = [];
      state.inserts = [];
    },
  };
});

vi.mock('../config/database.js', () => ({
  supabaseAdmin: {
    from: (table: string) => harness.from(table),
  },
}));

import { notifyCustomerPaymentStatus } from './customer-payment-notification.service.js';

const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const RESERVATION_ID = '44444444-4444-4444-8444-444444444444';

/** Columnas que 098 define para customer_notifications (fila mínima). */
const ALLOWED_COLUMNS = [
  'action_url',
  'body',
  'customer_id',
  'entity_id',
  'entity_type',
  'title',
  'type',
];

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  harness.reset();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('notifyCustomerPaymentStatus — Task 6', () => {
  it('payment_verified inserta con la reserva REAL y action_url de boleto', async () => {
    const result = await notifyCustomerPaymentStatus({
      type: 'payment_verified',
      customerId: CUSTOMER_ID,
      attemptId: ATTEMPT_ID,
      reservationId: RESERVATION_ID,
    });

    expect(result.status).toBe('inserted');

    // Pre-check por clave natural completa (dedupe sin source_event_id).
    expect(harness.lookups()).toHaveLength(1);
    expect(harness.lookups()[0]).toEqual([
      ['customer_id', CUSTOMER_ID],
      ['type', 'payment_verified'],
      ['entity_type', 'reservation'],
      ['entity_id', RESERVATION_ID],
    ]);

    expect(harness.inserts()).toHaveLength(1);
    const row = harness.inserts()[0];
    // Solo columnas que 098 define: nada de ownership ajeno ni datos extra.
    expect(Object.keys(row).sort()).toEqual(ALLOWED_COLUMNS);
    expect(row.customer_id).toBe(CUSTOMER_ID);
    expect(row.type).toBe('payment_verified');
    expect(row.entity_type).toBe('reservation');
    expect(row.entity_id).toBe(RESERVATION_ID);
    expect(row.action_url).toBe(`/account/purchases/${ATTEMPT_ID}/ticket`);
    expect(row.title).toBe('Pago verificado');
    expect(typeof row.body).toBe('string');

    // Sin datos sensibles (montos, motivos, referencias, storage).
    const wire = JSON.stringify(row);
    expect(wire).not.toMatch(/amount|reason|reference|proof|bank/i);

    // Camino exitoso sin ruido en logs.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('payment_rejected inserta referenciando el intento (sin reserva) y action_url de corrección', async () => {
    const result = await notifyCustomerPaymentStatus({
      type: 'payment_rejected',
      customerId: CUSTOMER_ID,
      attemptId: ATTEMPT_ID,
    });

    expect(result.status).toBe('inserted');
    expect(harness.inserts()).toHaveLength(1);
    const row = harness.inserts()[0];

    expect(Object.keys(row).sort()).toEqual(ALLOWED_COLUMNS);
    expect(row.type).toBe('payment_rejected');
    // Workaround documentado: el rechazo no crea reserva y el CHECK de
    // 098 solo admite reservation|review_request.
    expect(row.entity_type).toBe('reservation');
    expect(row.entity_id).toBe(ATTEMPT_ID);
    expect(row.action_url).toBe(`/account/purchases/${ATTEMPT_ID}/payment`);

    // Clave natural de dedupe por intento (distinta de la de verified).
    expect(harness.lookups()[0]).toEqual([
      ['customer_id', CUSTOMER_ID],
      ['type', 'payment_rejected'],
      ['entity_type', 'reservation'],
      ['entity_id', ATTEMPT_ID],
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('customerId ausente o inválido: failed SIN tocar la BD, con log', async () => {
    for (const customerId of [null, '', 'no-es-uuid', 42 as unknown as string]) {
      harness.reset();
      const result = await notifyCustomerPaymentStatus({
        type: 'payment_verified',
        customerId,
        attemptId: ATTEMPT_ID,
        reservationId: RESERVATION_ID,
      });

      expect(result.status).toBe('failed');
      expect(harness.lookups()).toHaveLength(0);
      expect(harness.inserts()).toHaveLength(0);
    }

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"CUSTOMER_NOTIFICATION_INVALID_INPUT"'),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"field":"customer_id"'),
    );
  });

  it('attemptId inválido: failed sin lookup ni insert', async () => {
    const result = await notifyCustomerPaymentStatus({
      type: 'payment_rejected',
      customerId: CUSTOMER_ID,
      attemptId: 'no-es-uuid',
    });

    expect(result.status).toBe('failed');
    expect(harness.lookups()).toHaveLength(0);
    expect(harness.inserts()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"field":"attempt_id"'),
    );
  });

  it('payment_verified sin reservationId válida: failed sin lookup ni insert', async () => {
    for (const reservationId of [
      null,
      undefined as unknown as string,
      'no-es-uuid',
    ]) {
      harness.reset();
      const result = await notifyCustomerPaymentStatus({
        type: 'payment_verified',
        customerId: CUSTOMER_ID,
        attemptId: ATTEMPT_ID,
        reservationId,
      });

      expect(result.status).toBe('failed');
      expect(harness.lookups()).toHaveLength(0);
      expect(harness.inserts()).toHaveLength(0);
    }

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"field":"reservation_id"'),
    );
  });

  it('tipo desconocido (caller JS): failed sin BD y sin lanzar', async () => {
    const result = await notifyCustomerPaymentStatus({
      type: 'payment_status_changed',
      customerId: CUSTOMER_ID,
      attemptId: ATTEMPT_ID,
    } as never);

    expect(result.status).toBe('failed');
    expect(harness.lookups()).toHaveLength(0);
    expect(harness.inserts()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"field":"type"'),
    );
  });

  it('duplicado en el pre-check: duplicate y SIN segundo INSERT', async () => {
    harness.pushLookup({ data: { id: 'notif-1' }, error: null });

    const result = await notifyCustomerPaymentStatus({
      type: 'payment_rejected',
      customerId: CUSTOMER_ID,
      attemptId: ATTEMPT_ID,
    });

    expect(result.status).toBe('duplicate');
    expect(harness.lookups()).toHaveLength(1);
    expect(harness.inserts()).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('fallo del lookup: failed sin insert y con log observable', async () => {
    harness.pushLookup({ data: null, error: { message: 'connection reset' } });

    const result = await notifyCustomerPaymentStatus({
      type: 'payment_verified',
      customerId: CUSTOMER_ID,
      attemptId: ATTEMPT_ID,
      reservationId: RESERVATION_ID,
    });

    expect(result.status).toBe('failed');
    expect(harness.inserts()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"CUSTOMER_NOTIFICATION_LOOKUP_FAILED"'),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('connection reset'),
    );
  });

  it('fallo del INSERT (error de BD): failed + log, nunca throw', async () => {
    harness.pushInsert({
      data: null,
      error: { message: 'relation does not exist', code: '42P01' },
    });

    await expect(
      notifyCustomerPaymentStatus({
        type: 'payment_verified',
        customerId: CUSTOMER_ID,
        attemptId: ATTEMPT_ID,
        reservationId: RESERVATION_ID,
      }),
    ).resolves.toEqual({ status: 'failed' });

    expect(harness.inserts()).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"CUSTOMER_NOTIFICATION_INSERT_FAILED"'),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('relation does not exist'),
    );
  });

  it('INSERT con conflicto 23505: duplicate (defensivo, sin throw)', async () => {
    harness.pushInsert({
      data: null,
      error: { message: 'duplicate key value violates unique constraint', code: '23505' },
    });

    const result = await notifyCustomerPaymentStatus({
      type: 'payment_rejected',
      customerId: CUSTOMER_ID,
      attemptId: ATTEMPT_ID,
    });

    expect(result.status).toBe('duplicate');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('la BD lanza (red caída): failed con log y sin excepción propagada', async () => {
    harness.pushLookup(new Error('fetch failed'));

    await expect(
      notifyCustomerPaymentStatus({
        type: 'payment_rejected',
        customerId: CUSTOMER_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toEqual({ status: 'failed' });

    expect(harness.inserts()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"CUSTOMER_NOTIFICATION_LOOKUP_FAILED"'),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('fetch failed'),
    );
  });
});
