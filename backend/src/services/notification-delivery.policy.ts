import { getCategoryForNotificationType } from '../constants/notification-categories.js';
import type { NotificationType } from './notification.service.js';
import {
  createDefaultPreferences,
  notificationPreferenceService,
  type AgencyNotificationPreferences,
  type CategoryPreference,
} from './notification-preference.service.js';

export type NotificationChannel = 'in_app' | 'email';

export interface AgencyNotificationRow {
  type: NotificationType;
  recipient_role: 'agency' | 'superadmin';
  agency_id?: string | null;
}

function isChannelEnabled(
  pref: CategoryPreference,
  channel: NotificationChannel,
): boolean {
  return channel === 'in_app' ? pref.in_app_enabled : pref.email_enabled;
}

export function isDeliveryEnabled(
  prefs: AgencyNotificationPreferences,
  type: NotificationType,
  channel: NotificationChannel,
): boolean {
  const category = getCategoryForNotificationType(type);
  if (!category) return true;
  return isChannelEnabled(prefs[category], channel);
}

export class NotificationDeliveryPolicy {
  async shouldDeliver(
    agencyId: string,
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<boolean> {
    try {
      const prefs = await notificationPreferenceService.getForAgency(agencyId);
      return isDeliveryEnabled(prefs, type, channel);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'NOTIF_PREF_LOOKUP_FAILED',
          agencyId,
          type,
          channel,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return true;
    }
  }

  async filterAgencyNotificationRows<T extends AgencyNotificationRow>(
    rows: T[],
  ): Promise<T[]> {
    if (rows.length === 0) return rows;

    const agencyRows = rows.filter(
      (row) => row.recipient_role === 'agency' && row.agency_id,
    );
    const otherRows = rows.filter(
      (row) => row.recipient_role !== 'agency' || !row.agency_id,
    );

    if (agencyRows.length === 0) return rows;

    try {
      const agencyIds = [
        ...new Set(agencyRows.map((row) => row.agency_id as string)),
      ];
      const prefsMap =
        await notificationPreferenceService.getForAgencies(agencyIds);

      const filteredAgencyRows = agencyRows.filter((row) => {
        const prefs =
          prefsMap.get(row.agency_id as string) ?? createDefaultPreferences();
        return isDeliveryEnabled(prefs, row.type, 'in_app');
      });

      return [...filteredAgencyRows, ...otherRows];
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'NOTIF_PREF_BULK_LOOKUP_FAILED',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return rows;
    }
  }
}

export const notificationDeliveryPolicy = new NotificationDeliveryPolicy();
