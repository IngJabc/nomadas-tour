import { supabaseAdmin } from '../config/database.js';
import { AppError, ValidationError } from '../errors/index.js';
import type {
  AuditAction,
  AuditEntityType,
  AuditEventDTO,
  AuditListResponse,
  AuditLogRow,
  AuditQueryFilters,
} from '../types/audit.js';
import {
  encodeAuditCursor,
  quotePostgrestValue,
} from '../utils/audit-cursor.js';
import { sanitizeAuditChanges } from '../utils/audit-changes.js';

const AUDIT_SELECT =
  'id, occurred_at, actor_user_id, actor_role, agency_id, action, entity_type, entity_id, before, after, metadata';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Metadata keys allowed for superadmin responses (F5-001 allow-list). */
export const ADMIN_METADATA_KEYS = [
  'source',
  'ip',
  'user_agent',
  'seat_code',
  'freed_seat_count',
] as const;

/** Metadata keys allowed for agency responses (no ip / user_agent). */
export const AGENCY_METADATA_KEYS = [
  'source',
  'seat_code',
  'freed_seat_count',
] as const;

const FORBIDDEN_METADATA_KEYS = new Set([
  'authorization',
  'cookie',
  'cookies',
  'token',
  'password',
  'password_hash',
  'qr_code',
  'ticket_code',
  'name',
  'document',
  'phone',
  'email',
  'contact_email',
]);

export type AuditReadRole = 'superadmin' | 'agency';

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
  role: AuditReadRole,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  const allow = new Set<string>(
    role === 'superadmin' ? ADMIN_METADATA_KEYS : AGENCY_METADATA_KEYS,
  );
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_METADATA_KEYS.has(lower)) continue;
    if (!allow.has(key)) continue;
    out[key] = value;
  }

  return out;
}

export function toAuditEventDTO(
  row: AuditLogRow,
  role: AuditReadRole,
): AuditEventDTO {
  const actor =
    row.actor_role === 'system' || row.actor_user_id == null
      ? null
      : {
          user_id: row.actor_user_id,
          role: row.actor_role as 'superadmin' | 'agency',
          agency_id: row.agency_id,
        };

  const changes = sanitizeAuditChanges(row.action, row.before, row.after);

  return {
    id: row.id,
    occurred_at: row.occurred_at,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    agency_id: row.agency_id,
    actor,
    before: changes.before,
    after: changes.after,
    metadata: sanitizeAuditMetadata(row.metadata, role),
  };
}

/** Build PostgREST keyset clause for ORDER BY occurred_at DESC, id DESC. */
export function buildKeysetOrFilter(occurredAt: string, id: string): string {
  const t = quotePostgrestValue(occurredAt);
  if (!UUID_RE.test(id)) {
    throw new ValidationError('Invalid input', [
      { path: ['cursor'], message: 'Invalid cursor' },
    ]);
  }
  return `occurred_at.lt.${t},and(occurred_at.eq.${t},id.lt.${id})`;
}

/** Agency tenant OR: own agency_id OR trip.* for assigned trips. */
export function buildAgencyTenantOrFilter(
  agencyId: string,
  tripIds: string[],
): string {
  if (!UUID_RE.test(agencyId)) {
    throw new ValidationError('Invalid agency context');
  }
  const safeTrips = tripIds.filter((id) => UUID_RE.test(id));
  if (safeTrips.length === 0) {
    // Caller should use .eq('agency_id', agencyId) instead of empty .in().
    return `agency_id.eq.${agencyId}`;
  }
  return `agency_id.eq.${agencyId},and(entity_type.eq.trip,entity_id.in.(${safeTrips.join(',')}))`;
}

async function listAgencyTripIds(agencyId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('trip_agencies')
    .select('trip_id')
    .eq('agency_id', agencyId);

  if (error) {
    throw new AppError(error.message, 500, 'AUDIT_QUERY_FAILED');
  }

  return (data ?? [])
    .map((row: { trip_id: string }) => row.trip_id)
    .filter((id: string) => UUID_RE.test(id));
}

type QueryBuilder = {
  eq: (col: string, val: string) => QueryBuilder;
  gte: (col: string, val: string) => QueryBuilder;
  lte: (col: string, val: string) => QueryBuilder;
  or: (filter: string) => QueryBuilder;
  order: (
    col: string,
    opts: { ascending: boolean },
  ) => QueryBuilder;
  limit: (n: number) => QueryBuilder;
  then?: (
    resolve: (value: {
      data: AuditLogRow[] | null;
      error: { message: string } | null;
    }) => void,
  ) => void;
};

function applyCommonFilters(
  query: QueryBuilder,
  filters: AuditQueryFilters,
): QueryBuilder {
  let q = query;
  if (filters.action) q = q.eq('action', filters.action);
  if (filters.entity_type) q = q.eq('entity_type', filters.entity_type);
  if (filters.entity_id) q = q.eq('entity_id', filters.entity_id);
  if (filters.actor_user_id) q = q.eq('actor_user_id', filters.actor_user_id);
  if (filters.from) q = q.gte('occurred_at', filters.from);
  if (filters.to) q = q.lte('occurred_at', filters.to);
  if (filters.cursor) {
    q = q.or(
      buildKeysetOrFilter(filters.cursor.t, filters.cursor.i),
    );
  }
  return q;
}

async function executeAuditQuery(
  role: AuditReadRole,
  filters: AuditQueryFilters,
  applyTenant: (q: QueryBuilder) => QueryBuilder,
): Promise<AuditListResponse> {
  const base = supabaseAdmin
    .from('audit_log')
    .select(AUDIT_SELECT) as unknown as QueryBuilder;

  // Do not `await` the builder — PostgREST builders are thenable and
  // awaiting them executes the query immediately.
  let query = applyTenant(base);
  query = applyCommonFilters(query, filters);
  query = query
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(filters.limit + 1);

  const { data, error } = await (query as unknown as Promise<{
    data: AuditLogRow[] | null;
    error: { message: string } | null;
  }>);

  if (error) {
    throw new AppError(error.message, 500, 'AUDIT_QUERY_FAILED');
  }

  const rows = data ?? [];
  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => toAuditEventDTO(row, role)),
    next_cursor:
      hasMore && last
        ? encodeAuditCursor({ t: last.occurred_at, i: last.id })
        : null,
  };
}

export class AuditService {
  async getAdminAudit(filters: AuditQueryFilters): Promise<AuditListResponse> {
    return executeAuditQuery('superadmin', filters, (q) => {
      if (filters.agency_id) {
        return q.eq('agency_id', filters.agency_id);
      }
      return q;
    });
  }

  async getAgencyAudit(
    agencyId: string,
    filters: AuditQueryFilters,
  ): Promise<AuditListResponse> {
    if (!agencyId) {
      throw new ValidationError('Agency context required');
    }
    if (filters.agency_id !== undefined) {
      // Defense in depth — controller must already reject this.
      throw new ValidationError('Invalid input', [
        { path: ['agency_id'], message: 'agency_id is not allowed for agency audit' },
      ]);
    }

    const tripIds = await listAgencyTripIds(agencyId);

    return executeAuditQuery('agency', filters, (q) => {
      if (tripIds.length === 0) {
        return q.eq('agency_id', agencyId);
      }
      return q.or(buildAgencyTenantOrFilter(agencyId, tripIds));
    });
  }
}

export const auditService = new AuditService();

/** Re-export action/entity unions for schema wiring. */
export type { AuditAction, AuditEntityType };
