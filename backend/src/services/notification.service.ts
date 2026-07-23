import { supabaseAdmin } from '../config/database.js';

export type NotificationType =
  | 'trip_created'
  | 'trip_cancelled'
  | 'trip_completed'
  | 'trip_auto_completed'
  | 'trip_postponed'
  | 'trip_deleted'
  | 'reservation_created'
  | 'reservation_cancelled'
  | 'passenger_cancelled';

export type EntityType = 'trip' | 'reservation' | 'passenger';
export type RecipientRole = 'agency' | 'superadmin';
export type NotificationActor = 'superadmin' | 'agency' | 'system';

interface CreateNotificationParams {
  type: NotificationType;
  title: string;
  body: string;
  entityType: EntityType;
  entityId: string;
  agencyId?: string | null;
  recipientRole: RecipientRole;
  action_url?: string;
  metadata?: Record<string, unknown>;
}

export class NotificationService {
  async createNotification(params: CreateNotificationParams): Promise<void> {
    const { error } = await supabaseAdmin
      .from('notifications')
      .insert({
        type: params.type,
        title: params.title,
        body: params.body,
        entity_type: params.entityType,
        entity_id: params.entityId,
        agency_id: params.agencyId || null,
        recipient_role: params.recipientRole,
        action_url: params.action_url ?? null,
        metadata: params.metadata ?? {},
      });

    if (error) {
      console.error(JSON.stringify({
        event: 'NOTIFICATION_INSERT_FAILED',
        type: params.type,
        entityType: params.entityType,
        entityId: params.entityId,
        error: error.message,
      }));
    }
  }

  async createForAgenciesAndAdmin(params: {
    type: NotificationType;
    title: string;
    body: string;
    entityType: EntityType;
    entityId: string;
    agencyIds: string[];
    actor: NotificationActor;
    action_url?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const rows = [];

    for (const agencyId of params.agencyIds) {
      rows.push({
        type: params.type,
        title: params.title,
        body: params.body,
        entity_type: params.entityType,
        entity_id: params.entityId,
        agency_id: agencyId,
        recipient_role: 'agency' as const,
        action_url: params.action_url ?? null,
        metadata: params.metadata ?? {},
      });
    }

    if (params.actor === 'system') {
      rows.push({
        type: params.type,
        title: params.title,
        body: params.body,
        entity_type: params.entityType,
        entity_id: params.entityId,
        agency_id: null,
        recipient_role: 'superadmin' as const,
        action_url: params.action_url ?? null,
        metadata: params.metadata ?? {},
      });
    }

    if (rows.length === 0) return;

    const { error } = await supabaseAdmin
      .from('notifications')
      .insert(rows);

    if (error) {
      console.error(JSON.stringify({
        event: 'NOTIFICATION_BULK_INSERT_FAILED',
        type: params.type,
        entityType: params.entityType,
        entityId: params.entityId,
        agencyCount: params.agencyIds.length,
        actor: params.actor,
        error: error.message,
      }));
    }
  }

  async createForAgency(params: {
    type: NotificationType;
    title: string;
    body: string;
    entityType: EntityType;
    entityId: string;
    agencyId: string;
    actor: NotificationActor;
    action_url?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const rows = [];

    if (params.actor === 'system') {
      rows.push({
        type: params.type,
        title: params.title,
        body: params.body,
        entity_type: params.entityType,
        entity_id: params.entityId,
        agency_id: params.agencyId,
        recipient_role: 'agency' as const,
        action_url: params.action_url ?? null,
        metadata: params.metadata ?? {},
      });
    }

    if (params.actor === 'agency') {
      rows.push({
        type: params.type,
        title: params.title,
        body: params.body,
        entity_type: params.entityType,
        entity_id: params.entityId,
        agency_id: null,
        recipient_role: 'superadmin' as const,
        action_url: params.action_url ?? null,
        metadata: params.metadata ?? {},
      });
    }

    if (rows.length === 0) return;

    const { error } = await supabaseAdmin
      .from('notifications')
      .insert(rows);

    if (error) {
      console.error(JSON.stringify({
        event: 'NOTIFICATION_INSERT_FAILED',
        type: params.type,
        entityType: params.entityType,
        entityId: params.entityId,
        agencyId: params.agencyId,
        actor: params.actor,
        error: error.message,
      }));
    }
  }

  async getAgencyNotifications(agencyId: string, limit: number = 20) {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return data || [];
  }

  async getAdminNotifications(limit: number = 20) {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('recipient_role', 'superadmin')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return data || [];
  }

  async markAsRead(notificationId: string, userId: string, role: string, agencyId?: string) {
    let query = supabaseAdmin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .is('read_at', null);

    if (role === 'agency' && agencyId) {
      query = query.eq('agency_id', agencyId);
    }

    const { error } = await query;
    if (error) throw new Error(error.message);
  }

  async markAllAsRead(userId: string, role: string, agencyId?: string) {
    let query = supabaseAdmin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null);

    if (role === 'agency' && agencyId) {
      query = query.eq('agency_id', agencyId);
    } else if (role === 'superadmin') {
      query = query.eq('recipient_role', 'superadmin');
    }

    const { error } = await query;
    if (error) throw new Error(error.message);
  }

  async getUnreadCount(role: string, agencyId?: string): Promise<number> {
    let query = supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);

    if (role === 'agency' && agencyId) {
      query = query.eq('agency_id', agencyId);
    } else if (role === 'superadmin') {
      query = query.eq('recipient_role', 'superadmin');
    }

    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count || 0;
  }
}

export const notificationService = new NotificationService();
