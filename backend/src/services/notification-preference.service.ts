import { supabaseAdmin } from '../config/database.js';
import { ValidationError } from '../errors/index.js';
import {
  NOTIFICATION_CATEGORIES,
  LOCKED_CATEGORIES,
  CATEGORY_METADATA,
  type NotificationCategory,
} from '../constants/notification-categories.js';

export interface CategoryPreference {
  in_app_enabled: boolean;
  email_enabled: boolean;
}

export type AgencyNotificationPreferences = Record<
  NotificationCategory,
  CategoryPreference
>;

export function createDefaultPreferences(): AgencyNotificationPreferences {
  return NOTIFICATION_CATEGORIES.reduce((acc, category) => {
    acc[category] = { in_app_enabled: true, email_enabled: true };
    return acc;
  }, {} as AgencyNotificationPreferences);
}

export function toPublicPreferences(
  prefs: AgencyNotificationPreferences,
): Record<NotificationCategory, boolean> {
  return NOTIFICATION_CATEGORIES.reduce((acc, category) => {
    acc[category] = prefs[category].in_app_enabled;
    return acc;
  }, {} as Record<NotificationCategory, boolean>);
}

export function toPublicCategories(prefs: AgencyNotificationPreferences) {
  return CATEGORY_METADATA.map((meta) => ({
    key: meta.key,
    label: meta.label,
    description: meta.description,
    locked: meta.locked,
    channels: {
      in_app: prefs[meta.key].in_app_enabled,
      email: prefs[meta.key].email_enabled,
    },
  }));
}

export class NotificationPreferenceService {
  async getForAgency(agencyId: string): Promise<AgencyNotificationPreferences> {
    const prefs = createDefaultPreferences();

    const { data, error } = await supabaseAdmin
      .from('agency_notification_preferences')
      .select('category, in_app_enabled, email_enabled')
      .eq('agency_id', agencyId);

    if (error) throw new Error(error.message);

    for (const row of data || []) {
      if (this.isValidCategory(row.category)) {
        prefs[row.category] = {
          in_app_enabled: row.in_app_enabled,
          email_enabled: row.email_enabled,
        };
      }
    }

    return prefs;
  }

  async getForAgencies(
    agencyIds: string[],
  ): Promise<Map<string, AgencyNotificationPreferences>> {
    const map = new Map<string, AgencyNotificationPreferences>();
    if (agencyIds.length === 0) return map;

    for (const agencyId of agencyIds) {
      map.set(agencyId, createDefaultPreferences());
    }

    const { data, error } = await supabaseAdmin
      .from('agency_notification_preferences')
      .select('agency_id, category, in_app_enabled, email_enabled')
      .in('agency_id', agencyIds);

    if (error) throw new Error(error.message);

    for (const row of data || []) {
      const prefs = map.get(row.agency_id);
      if (prefs && this.isValidCategory(row.category)) {
        prefs[row.category] = {
          in_app_enabled: row.in_app_enabled,
          email_enabled: row.email_enabled,
        };
      }
    }

    return map;
  }

  async seedDefaults(agencyId: string): Promise<void> {
    const rows = NOTIFICATION_CATEGORIES.map((category) => ({
      agency_id: agencyId,
      category,
      in_app_enabled: true,
      email_enabled: true,
    }));

    const { error } = await supabaseAdmin
      .from('agency_notification_preferences')
      .upsert(rows, { onConflict: 'agency_id,category', ignoreDuplicates: true });

    if (error) throw new ValidationError(error.message);
  }

  async updateForAgency(
    agencyId: string,
    patch: Partial<Record<NotificationCategory, boolean>>,
  ): Promise<AgencyNotificationPreferences> {
    for (const [category, enabled] of Object.entries(patch)) {
      if (!this.isValidCategory(category)) {
        throw new ValidationError(`Unknown notification category: ${category}`);
      }
      if (LOCKED_CATEGORIES.has(category) && enabled === false) {
        throw new ValidationError(`${category} cannot be disabled`);
      }
    }

    const now = new Date().toISOString();

    for (const [category, enabled] of Object.entries(patch)) {
      if (!this.isValidCategory(category) || enabled === undefined) continue;

      const { error } = await supabaseAdmin
        .from('agency_notification_preferences')
        .upsert(
          {
            agency_id: agencyId,
            category,
            in_app_enabled: enabled,
            email_enabled: enabled,
            updated_at: now,
          },
          { onConflict: 'agency_id,category' },
        );

      if (error) throw new ValidationError(error.message);
    }

    return this.getForAgency(agencyId);
  }

  private isValidCategory(value: string): value is NotificationCategory {
    return (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
  }
}

export const notificationPreferenceService = new NotificationPreferenceService();
