import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/index.js';
import type { RequestContext } from '../types/index.js';

/**
 * MKT-010.1 (lado Tour) — `set_trip_payment_plan`.
 *
 * Lo que se cubre aqui (capa HTTP/ servicio, sin BD):
 *  - el actor sale SIEMPRE del ctx de sesión, nunca del body;
 *  - solo rol `agency` con `agencyId` pasa la defensa en profundidad;
 *  - la forma: al habilitar exige importe entero > 0 y ambas fechas;
 *  - las fechas `YYYY-MM-DD` viajan como fin de día (`T23:59:59`);
 *  - al deshabilitar se envían nulls explícitos (la RPC limpia);
 *  - los ERR_* de la RPC se traducen a las clases HTTP del repo.
 *
 * La autorización real (exclusividad, estado activo) la decide la RPC
 * en la BD; aqui solo se verifica que se le pasa lo correcto.
 */

const mockRpc = vi.hoisted(() => vi.fn());

vi.mock('../config/database.js', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { paymentPlanService } from './payment-plan.service.js';

const TRIP_1 = '11111111-1111-4111-8111-111111111111';
const ACTOR_1 = '33333333-3333-4333-8333-333333333333';

const agencyCtx: RequestContext = {
  userId: ACTOR_1,
  role: 'agency',
  agencyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

const enabledInput = {
  enabled: true,
  deposit_amount_cents: 50000,
  deposit_deadline: '2026-11-20',
  balance_deadline: '2026-11-30',
};

const okRow = {
  trip_id: TRIP_1,
  payment_plan: 'two_stage',
  deposit_amount_cents: 50000,
  deposit_deadline: '2026-11-20T23:59:59',
  balance_deadline: '2026-11-30T23:59:59',
  audit_id: 'audit-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PaymentPlanService.setTripPaymentPlan', () => {
  it('passes the actor from ctx (never from the body) and the trip id', async () => {
    mockRpc.mockResolvedValue({ data: okRow, error: null });

    await paymentPlanService.setTripPaymentPlan(agencyCtx, TRIP_1, enabledInput);

    expect(mockRpc).toHaveBeenCalledWith('set_trip_payment_plan', {
      p_trip_id: TRIP_1,
      p_actor_user_id: ACTOR_1,
      p_enabled: true,
      p_deposit_amount_cents: 50000,
      p_deposit_deadline: '2026-11-20T23:59:59',
      p_balance_deadline: '2026-11-30T23:59:59',
    });
    // Un body con otro actor jamás llega a la RPC: el service solo
    // conoce el ctx.
    expect(JSON.stringify(mockRpc.mock.calls[0][1])).not.toContain('agency_id');
  });

  it('returns the RPC row as-is', async () => {
    mockRpc.mockResolvedValue({ data: okRow, error: null });

    const result = await paymentPlanService.setTripPaymentPlan(
      agencyCtx,
      TRIP_1,
      enabledInput,
    );

    expect(result).toEqual(okRow);
  });

  it('normalizes both deadlines to end of day', async () => {
    mockRpc.mockResolvedValue({ data: okRow, error: null });

    await paymentPlanService.setTripPaymentPlan(agencyCtx, TRIP_1, {
      ...enabledInput,
      deposit_deadline: '2026-12-01',
      balance_deadline: '2026-12-15',
    });

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params.p_deposit_deadline).toBe('2026-12-01T23:59:59');
    expect(params.p_balance_deadline).toBe('2026-12-15T23:59:59');
  });

  it('sends explicit nulls when disabling the plan', async () => {
    mockRpc.mockResolvedValue({
      data: {
        trip_id: TRIP_1,
        payment_plan: 'single',
        deposit_amount_cents: null,
        deposit_deadline: null,
        balance_deadline: null,
        audit_id: 'audit-2',
      },
      error: null,
    });

    const result = await paymentPlanService.setTripPaymentPlan(agencyCtx, TRIP_1, {
      enabled: false,
    });

    expect(mockRpc).toHaveBeenCalledWith('set_trip_payment_plan', {
      p_trip_id: TRIP_1,
      p_actor_user_id: ACTOR_1,
      p_enabled: false,
      p_deposit_amount_cents: null,
      p_deposit_deadline: null,
      p_balance_deadline: null,
    });
    expect(result.payment_plan).toBe('single');
  });

  it('ignores deposit/deadline values when disabling', async () => {
    mockRpc.mockResolvedValue({ data: { trip_id: TRIP_1, payment_plan: 'single' }, error: null });

    await paymentPlanService.setTripPaymentPlan(agencyCtx, TRIP_1, {
      enabled: false,
      deposit_amount_cents: 999999,
      deposit_deadline: '2026-11-20',
      balance_deadline: '2026-11-30',
    });

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params.p_deposit_amount_cents).toBeNull();
    expect(params.p_deposit_deadline).toBeNull();
    expect(params.p_balance_deadline).toBeNull();
  });

  it('rejects a non-agency actor before touching the RPC', async () => {
    await expect(
      paymentPlanService.setTripPaymentPlan(
        { userId: ACTOR_1, role: 'superadmin', agencyId: null },
        TRIP_1,
        enabledInput,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects an agency ctx without agencyId', async () => {
    await expect(
      paymentPlanService.setTripPaymentPlan(
        { userId: ACTOR_1, role: 'agency', agencyId: null },
        TRIP_1,
        enabledInput,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a missing/invalid enabled flag', async () => {
    await expect(
      paymentPlanService.setTripPaymentPlan(agencyCtx, TRIP_1, {
        enabled: undefined as unknown as boolean,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    ['zero deposit', { deposit_amount_cents: 0 }],
    ['negative deposit', { deposit_amount_cents: -100 }],
    ['fractional deposit', { deposit_amount_cents: 10.5 }],
    ['missing deposit', { deposit_amount_cents: undefined }],
  ])('rejects %s when enabling', async (_label, patch) => {
    await expect(
      paymentPlanService.setTripPaymentPlan(agencyCtx, TRIP_1, {
        ...enabledInput,
        ...patch,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects enabling without both deadlines', async () => {
    await expect(
      paymentPlanService.setTripPaymentPlan(agencyCtx, TRIP_1, {
        enabled: true,
        deposit_amount_cents: 50000,
        deposit_deadline: '2026-11-20',
        balance_deadline: '',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    ['ERR_ACTOR_REQUIRED', ForbiddenError],
    ['ERR_ACTOR_NOT_FOUND', ForbiddenError],
    ['ERR_FORBIDDEN_ROLE', ForbiddenError],
    ['ERR_TRIP_NOT_EXCLUSIVE', ForbiddenError],
    ['ERR_TRIP_NOT_FOUND', NotFoundError],
    ['ERR_TRIP_NOT_ACTIVE', ValidationError],
    ['ERR_PAYMENT_PLAN_INPUT', ValidationError],
    ['ERR_PAYMENT_PLAN_DEPOSIT', ValidationError],
    ['ERR_PAYMENT_PLAN_PRICE', ValidationError],
    ['ERR_PAYMENT_PLAN_DEADLINES', ValidationError],
    ['ERR_SOMETHING_ELSE', AppError],
  ])('maps %s to the right error class', async (code, expected) => {
    mockRpc.mockResolvedValue({ data: null, error: { message: `${code}: detalle` } });

    await expect(
      paymentPlanService.setTripPaymentPlan(agencyCtx, TRIP_1, enabledInput),
    ).rejects.toBeInstanceOf(expected);
  });

  it('surfaces the RPC detail message in the mapped error', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'ERR_TRIP_NOT_EXCLUSIVE: El viaje no pertenece en exclusiva' },
    });

    await expect(
      paymentPlanService.setTripPaymentPlan(agencyCtx, TRIP_1, enabledInput),
    ).rejects.toMatchObject({ message: 'El viaje no pertenece en exclusiva' });
  });

  it('throws PAYMENT_PLAN_ERROR when the RPC returns no trip_id', async () => {
    mockRpc.mockResolvedValue({ data: { payment_plan: 'two_stage' }, error: null });

    await expect(
      paymentPlanService.setTripPaymentPlan(agencyCtx, TRIP_1, enabledInput),
    ).rejects.toMatchObject({ code: 'PAYMENT_PLAN_ERROR', statusCode: 500 });
  });
});
