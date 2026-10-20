import { supabaseAdmin } from '../config/database.js';
import { NotFoundError, ValidationError } from '../errors/index.js';

export const CONTACT_COLUMNS =
  'id, agency_id, label, phone, channel, is_active, is_public, sort_order, created_at, updated_at, deleted_at';

export type AgencyContactChannel = 'call' | 'whatsapp';

export interface AgencyContact {
  id: string;
  agency_id: string;
  label: string;
  phone: string;
  channel: AgencyContactChannel;
  is_active: boolean;
  is_public: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateAgencyContactInput {
  label: string;
  phone: string;
  channel: AgencyContactChannel;
  is_public?: boolean;
  sort_order?: number;
}

export interface UpdateAgencyContactInput {
  label?: string;
  phone?: string;
  channel?: AgencyContactChannel;
  is_public?: boolean;
  sort_order?: number;
  is_active?: boolean;
}

export interface AgencyContactMutationResult {
  contact: AgencyContact;
  audit_id: string | null;
  already_deleted?: boolean;
}

/** Extrae el mensaje legible de un error SQL con formato ERR_CODE: texto. */
function sqlMessage(raw: string): string {
  return raw.includes(': ') ? raw.slice(raw.indexOf(': ') + 2) : raw;
}

/**
 * Mapea los códigos de error conocidos de las RPC 091 a errores HTTP.
 * ERR_CONTACT_NOT_FOUND -> 404. El resto de errores de entrada o
 * autorización -> 400 ValidationError. ERR_CONTACT_DUPLICATE -> 400 con
 * mensaje claro (número ya registrado en la agencia).
 */
function mapRpcError(error: { message?: string } | null): never {
  const raw = error?.message ?? 'Error de base de datos';

  if (raw.includes('ERR_CONTACT_NOT_FOUND')) {
    throw new NotFoundError('Contacto no encontrado');
  }
  if (raw.includes('ERR_CONTACT_DUPLICATE')) {
    throw new ValidationError(
      'Ya existe un contacto con este número de teléfono en tu agencia.',
    );
  }
  if (
    raw.includes('ERR_CONTACT_ACTOR') ||
    raw.includes('ERR_CONTACT_ROLE') ||
    raw.includes('ERR_CONTACT_AGENCY') ||
    raw.includes('ERR_CONTACT_DATA') ||
    raw.includes('ERR_CONTACT_INPUT')
  ) {
    throw new ValidationError(sqlMessage(raw));
  }
  throw new ValidationError(raw);
}

function toPublic(row: Record<string, unknown>): AgencyContact {
  return {
    id: String(row.id),
    agency_id: String(row.agency_id),
    label: String(row.label),
    phone: String(row.phone),
    channel: row.channel as AgencyContactChannel,
    is_active: Boolean(row.is_active),
    is_public: Boolean(row.is_public),
    sort_order: Number(row.sort_order ?? 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    deleted_at: row.deleted_at ? String(row.deleted_at) : null,
  };
}

export class AgencyContactService {
  /** Contactos vivos de la agencia: orden por sort_order. */
  async list(agencyId: string): Promise<AgencyContact[]> {
    const { data, error } = await supabaseAdmin
      .from('agency_contacts')
      .select(CONTACT_COLUMNS)
      .eq('agency_id', agencyId)
      .is('deleted_at', null)
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
    input: CreateAgencyContactInput,
  ): Promise<AgencyContact> {
    const { data, error } = await supabaseAdmin.rpc('create_agency_contact', {
      p_agency_id: agencyId,
      p_actor_user_id: actorUserId,
      p_label: input.label,
      p_phone: input.phone,
      p_channel: input.channel,
      p_is_public: input.is_public ?? false,
      p_sort_order: input.sort_order ?? 0,
    });

    if (error) mapRpcError(error);
    if (!data?.contact) {
      throw new NotFoundError('Contacto no encontrado');
    }

    return toPublic(data.contact);
  }

  async update(
    agencyId: string,
    actorUserId: string,
    contactId: string,
    input: UpdateAgencyContactInput,
  ): Promise<AgencyContact> {
    const { data, error } = await supabaseAdmin.rpc('update_agency_contact', {
      p_agency_id: agencyId,
      p_actor_user_id: actorUserId,
      p_contact_id: contactId,
      p_label: input.label ?? null,
      p_phone: input.phone ?? null,
      p_channel: input.channel ?? null,
      p_is_public: input.is_public ?? null,
      p_sort_order: input.sort_order ?? null,
      p_is_active: input.is_active ?? null,
    });

    if (error) mapRpcError(error);
    if (!data?.contact) {
      throw new NotFoundError('Contacto no encontrado');
    }

    return toPublic(data.contact);
  }

  async remove(
    agencyId: string,
    actorUserId: string,
    contactId: string,
  ): Promise<AgencyContactMutationResult> {
    const { data, error } = await supabaseAdmin.rpc('delete_agency_contact', {
      p_agency_id: agencyId,
      p_actor_user_id: actorUserId,
      p_contact_id: contactId,
    });

    if (error) mapRpcError(error);
    if (!data?.contact) {
      throw new NotFoundError('Contacto no encontrado');
    }

    return {
      contact: toPublic(data.contact),
      audit_id: data.audit_id ?? null,
      already_deleted: Boolean(data.already_deleted),
    };
  }
}

export const agencyContactService = new AgencyContactService();
