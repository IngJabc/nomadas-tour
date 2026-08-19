/** F5-003 — Frontend types aligned with F5-002 Audit Trail Read API */

export const AUDIT_ACTIONS = [
  'trip.created',
  'trip.updated',
  'trip.cancelled',
  'reservation.created',
  'reservation.cancelled',
  'boarding.board',
  'boarding.unboard',
  'agency_settings.updated',
  'notification_preferences.updated',
  'reservation_link.created',
  'reservation_link.cancelled',
  'reservation_link.confirmed',
  'reservation_link.regenerated',
  'reservation_link.passenger_data_saved',
  'reservation_link.expired',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  'trip',
  'reservation',
  'reservation_passenger',
  'agency_settings',
  'notification_preferences',
  'reservation_link',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export type AuditActorRole = 'superadmin' | 'agency' | 'system';

export interface AuditActor {
  user_id: string;
  role: AuditActorRole;
  agency_id: string | null;
}

export interface AuditEventDTO {
  id: string;
  occurred_at: string;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string | null;
  agency_id: string | null;
  actor: AuditActor | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface AuditListResponse {
  items: AuditEventDTO[];
  next_cursor: string | null;
}

export interface AuditQueryParams {
  from?: string;
  to?: string;
  action?: AuditAction | string;
  entity_type?: AuditEntityType | string;
  entity_id?: string;
  actor_user_id?: string;
  /** Admin only — never send from agency UI */
  agency_id?: string;
  limit?: string;
  cursor?: string;
}
