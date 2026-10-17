import { supabaseAdmin } from '../config/database.js';
import {
  AppError,
  NotFoundError,
  ValidationError,
} from '../errors/index.js';

export const PAYMENT_METHOD_COLUMNS =
  'id, agency_id, method, label, data, is_active, is_primary, sort_order, created_at, updated_at, deleted_at';

export interface AgencyPaymentMethod {
  id: string;
  agency_id: string;
  method: string;
  label: string;
  data: Record<string, unknown>;
  is_active: boolean;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateAgencyPaymentMethodInput {
  method: 'pago_movil';
  label: string;
  data: Record<string, unknown>;
  is_primary?: boolean;
  sort_order?: number;
}

export interface UpdateAgencyPaymentMethodInput {
  label?: string;
  data?: Record<string, unknown>;
  is_active?: boolean;
}

export interface AgencyPaymentMethodMutationResult {
  payment_method: AgencyPaymentMethod;
  audit_id: string | null;
  already_deleted?: boolean;
}

/** Extrae el mensaje legible de un error SQL con formato ERR_CODE: texto. */
function sqlMessage(raw: string): string {
  return raw.includes(': ') ? raw.slice(raw.indexOf(': ') + 2) : raw;
}

/**
 * Mapea los cÃ³digos de error conocidos de las RPC 089 a errores HTTP.
 * ERR_AGENCY_HAS_ACTIVE_CHECKOUTS -> 409 con el codigo publico
 * AGENCY_HAS_ACTIVE_CHECKOUTS (regla MKT-007.4: conflicto consistente).
 */
function mapRpcError(error: { message?: string } | null): never {
  const raw = error?.message ?? 'Error de base de datos';

  if (raw.includes('ERR_AGENCY_HAS_ACTIVE_CHECKOUTS')) {
    throw new AppError(
      'No se pueden modificar los métodos de pago mientras existan compras activas de la agencia.',
      409,
      'AGENCY_HAS_ACTIVE_CHECKOUTS',
    );
  }
  if (raw.includes('ERR_PAYMENT_METHOD_NOT_FOUND')) {
    throw new NotFoundError('Método de pago no encontrado');
  }
  if (raw.includes('ERR_PAYMENT_METHOD_UNSUPPORTED')) {
    throw new ValidationError('MÃ©todo de pago no soportado');
  }
  if (raw.includes('ERR_PAYMENT_METHOD_DATA')) {
    throw new ValidationError(sqlMessage(raw));
  }
  if (
    raw.includes('ERR_PAYMENT_METHOD_ACTOR') ||
    raw.includes('ERR_PAYMENT_METHOD_ROLE') ||
    raw.includes('ERR_PAYMENT_METHOD_AGENCY')
  ) {
    throw new ValidationError(sqlMessage(raw));
  }
  if (raw.includes('ERR_PAYMENT_METHOD_INPUT')) {
    throw new ValidationError(sqlMessage(raw));
  }
  throw new ValidationError(raw);
}

function toPublic(row: Record<string, unknown>): AgencyPaymentMethod {
  return {
    id: String(row.id),
    agency_id: String(row.agency_id),
    method: String(row.method),
    label: String(row.label),
    data: (row.data as Record<string, unknown>) ?? {},
    is_active: Boolean(row.is_active),
    is_primary: Boolean(row.is_primary),
    sort_order: Number(row.sort_order ?? 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    deleted_at: row.deleted_at ? String(row.deleted_at) : null,
  };
}

export class AgencyPaymentMethodService {
  /** Canales vivos de la agencia: primarios primero, luego sort_order. */
  async list(agencyId: string): Promise<AgencyPaymentMethod[]> {
    const { data, error } = await supabaseAdmin
      .from('agency_payment_methods')
      .select(PAYMENT_METHOD_COLUMNS)
      .eq('agency_id', agencyId)
      .is('deleted_at', null)
      .order('is_primary', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      throw new ValidationError(error.message);
    }

    return ((data ?? []) as Record<string, unknown>[]).map(toPublic);
  }

  async create(
    agencyId: string,
    actorUserId: string,
    input: CreateAgencyPaymentMethodInput,
  ): Promise<AgencyPaymentMethod> {
    const { data, error } = await supabaseAdmin.rpc(
      'create_agency_payment_method',
      {
        p_agency_id: agencyId,
        p_actor_user_id: actorUserId,
        p_method: input.method,
        p_label: input.label,
        p_data: input.data,
        p_is_primary: input.is_primary ?? false,
        p_sort_order: input.sort_order ?? 0,
      },
    );

    if (error) mapRpcError(error);
    if (!data?.payment_method) {
      throw new NotFoundError('Método de pago no encontrado');
    }

    return toPublic(data.payment_method);
  }

  async update(
    agencyId: string,
    actorUserId: string,
    methodId: string,
    input: UpdateAgencyPaymentMethodInput,
  ): Promise<AgencyPaymentMethod> {
    const { data, error } = await supabaseAdmin.rpc(
      'update_agency_payment_method',
      {
        p_agency_id: agencyId,
        p_actor_user_id: actorUserId,
        p_method_id: methodId,
        p_label: input.label ?? null,
        p_data: input.data ?? null,
        p_is_active: input.is_active ?? null,
      },
    );

    if (error) mapRpcError(error);
    if (!data?.payment_method) {
      throw new NotFoundError('Método de pago no encontrado');
    }

    return toPublic(data.payment_method);
  }

  async setPrimary(
    agencyId: string,
    actorUserId: string,
    methodId: string,
  ): Promise<AgencyPaymentMethod> {
    const { data, error } = await supabaseAdmin.rpc(
      'set_agency_payment_method_primary',
      {
        p_agency_id: agencyId,
        p_actor_user_id: actorUserId,
        p_method_id: methodId,
      },
    );

    if (error) mapRpcError(error);
    if (!data?.payment_method) {
      throw new NotFoundError('Método de pago no encontrado');
    }

    return toPublic(data.payment_method);
  }

  async remove(
    agencyId: string,
    actorUserId: string,
    methodId: string,
  ): Promise<AgencyPaymentMethodMutationResult> {
    const { data, error } = await supabaseAdmin.rpc(
      'delete_agency_payment_method',
      {
        p_agency_id: agencyId,
        p_actor_user_id: actorUserId,
        p_method_id: methodId,
      },
    );

    if (error) mapRpcError(error);
    if (!data?.payment_method) {
      throw new NotFoundError('Método de pago no encontrado');
    }

    return {
      payment_method: toPublic(data.payment_method),
      audit_id: data.audit_id ?? null,
      already_deleted: Boolean(data.already_deleted),
    };
  }
}

export const agencyPaymentMethodService = new AgencyPaymentMethodService();
