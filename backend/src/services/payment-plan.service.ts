import { supabaseAdmin } from '../config/database.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/index.js';
import type { RequestContext } from '../types/index.js';

/**
 * MKT-010.1 (lado Tour) — `PATCH /api/agency/trips/:tripId/payment-plan`.
 *
 * Habilita/deshabilita el pago en dos partes de un viaje de la agencia
 * mediante la RPC `set_trip_payment_plan` (migración 106). REGLAS:
 *
 * - El actor sale SIEMPRE de `req.ctx` (sesión + `public.users`); el
 *   body jamás puede declarar un `actor_user_id` ni un `agency_id`.
 * - La autorización final (rol agency, viaje `active`, UNA sola
 *   asignación en `trip_agencies` y que sea la del actor) la decide la
 *   RPC con `FOR UPDATE` sobre la fila del viaje. Esta capa solo
 *   valida la forma y traduce los ERR_* a errores HTTP en español.
 * - A diferencia de AS-TRIP-004, NO se exige cero reservas: el plan
 *   solo afecta a los intentos futuros.
 * - Al deshabilitar se limpian importe y vencimientos (la RPC los
 *   pone en NULL); aquí se envían null explícitos.
 */

/** Fecha de negocio (`YYYY-MM-DD`, DatePicker) → fin del día (23:59:59). */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDeadlineParam(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // El DatePicker entrega solo la fecha; el vencimiento es hasta el
  // FINAL de ese día, no la medianoche (que ya habría pasado en la
  // práctica al elegir "hoy").
  return DATE_ONLY_RE.test(trimmed) ? `${trimmed}T23:59:59` : trimmed;
}

export interface SetTripPaymentPlanInput {
  enabled: boolean;
  deposit_amount_cents?: number | null;
  deposit_deadline?: string | null;
  balance_deadline?: string | null;
}

export interface SetTripPaymentPlanResult {
  trip_id: string;
  payment_plan: 'single' | 'two_stage';
  deposit_amount_cents: number | null;
  deposit_deadline: string | null;
  balance_deadline: string | null;
  audit_id: string | null;
}

/** Mapa de los ERR_* de `set_trip_payment_plan` (migración 106). */
function mapPaymentPlanRpcError(error: { message?: string }): never {
  const raw = error?.message ?? 'Unknown payment plan RPC error';
  const codeMatch = /ERR_[A-Z0-9_]+/.exec(raw);
  const code = codeMatch?.[0];
  const detail = raw.includes(': ')
    ? raw.slice(raw.indexOf(': ') + 2)
    : raw;

  switch (code) {
    case 'ERR_ACTOR_REQUIRED':
    case 'ERR_ACTOR_NOT_FOUND':
    case 'ERR_FORBIDDEN_ROLE':
    case 'ERR_TRIP_NOT_EXCLUSIVE':
      throw new ForbiddenError(detail);
    case 'ERR_TRIP_NOT_FOUND':
      throw new NotFoundError('Viaje no encontrado');
    case 'ERR_TRIP_NOT_ACTIVE':
    case 'ERR_PAYMENT_PLAN_INPUT':
    case 'ERR_PAYMENT_PLAN_DEPOSIT':
    case 'ERR_PAYMENT_PLAN_PRICE':
    case 'ERR_PAYMENT_PLAN_DEADLINES':
      throw new ValidationError(detail);
    default:
      throw new AppError(
        'No se pudo guardar el plan de pagos. Intenta de nuevo',
        500,
        'PAYMENT_PLAN_ERROR',
      );
  }
}

export class PaymentPlanService {
  async setTripPaymentPlan(
    ctx: RequestContext,
    tripId: string,
    input: SetTripPaymentPlanInput,
  ): Promise<SetTripPaymentPlanResult> {
    // Defensa en profundidad: el middleware `authorize('agency')` ya
    // garantizó el rol, pero el service no acepta otro origen para el
    // actor ni para la agencia.
    if (ctx.role !== 'agency' || !ctx.agencyId) {
      throw new ForbiddenError('Solo las agencias pueden configurar el plan de pagos');
    }

    // Forma redundante con el schema del controller: el service nunca
    // asume que el caller validó (también se usa en tests).
    if (typeof input.enabled !== 'boolean') {
      throw new ValidationError('El estado del plan de pagos es obligatorio (true/false)');
    }
    if (input.enabled) {
      const deposit = input.deposit_amount_cents;
      if (typeof deposit !== 'number' || !Number.isInteger(deposit) || deposit <= 0) {
        throw new ValidationError(
          'El depósito debe ser un importe mayor a cero (centavos)',
        );
      }
      if (!toDeadlineParam(input.deposit_deadline) || !toDeadlineParam(input.balance_deadline)) {
        throw new ValidationError(
          'Ambos vencimientos son obligatorios (depósito y saldo)',
        );
      }
    }

    const { data, error } = await supabaseAdmin.rpc('set_trip_payment_plan', {
      p_trip_id: tripId,
      p_actor_user_id: ctx.userId,
      p_enabled: input.enabled,
      p_deposit_amount_cents: input.enabled ? input.deposit_amount_cents : null,
      p_deposit_deadline: input.enabled
        ? toDeadlineParam(input.deposit_deadline)
        : null,
      p_balance_deadline: input.enabled
        ? toDeadlineParam(input.balance_deadline)
        : null,
    });

    if (error) throw mapPaymentPlanRpcError(error);

    const row = data as SetTripPaymentPlanResult | null;
    if (!row?.trip_id) {
      throw new AppError(
        'No se pudo guardar el plan de pagos. Intenta de nuevo',
        500,
        'PAYMENT_PLAN_ERROR',
      );
    }

    return row;
  }
}

export const paymentPlanService = new PaymentPlanService();
