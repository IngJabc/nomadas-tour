import type { AuditAction } from '../types/audit.js';
import { NOTIFICATION_CATEGORIES } from '../constants/notification-categories.js';

const TRIP_FIELDS = [
  'route_id',
  'departure_time',
  'capacity',
  'vehicle_type',
] as const;

const RESERVATION_CREATED_FIELDS = [
  'trip_id',
  'passenger_count',
  'seat_codes',
] as const;

const STATUS_FIELDS = ['status'] as const;

const BRANDING_FIELDS = [
  'logo_url',
  'primary_color',
  'secondary_color',
  'accent_color',
] as const;

const RESERVATION_LINK_FIELDS = [
  'seat_codes',
  'status',
  'trip_id',
  'reservation_id',
  'old_link_id',
  'new_link_id',
  'reason',
] as const;

const PREF_CHANNEL_KEYS = new Set(['in_app', 'email']);
const PREF_CATEGORIES = new Set<string>(NOTIFICATION_CATEGORIES);

function pickAllowedKeys(
  source: Record<string, unknown> | null | undefined,
  allowed: readonly string[],
): Record<string, unknown> | null {
  if (source == null) return null;
  if (typeof source !== 'object' || Array.isArray(source)) return null;

  const allow = new Set(allowed);
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key) && allow.has(key)) {
      out[key] = source[key];
    }
  }
  return out;
}

function sanitizeNotificationPrefsDiff(
  source: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (source == null) return null;
  if (typeof source !== 'object' || Array.isArray(source)) return null;

  const out: Record<string, unknown> = {};
  for (const [category, value] of Object.entries(source)) {
    if (!PREF_CATEGORIES.has(category)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

    const channels: Record<string, unknown> = {};
    for (const [chKey, chVal] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (!PREF_CHANNEL_KEYS.has(chKey)) continue;
      if (typeof chVal !== 'boolean') continue;
      channels[chKey] = chVal;
    }
    if (Object.keys(channels).length > 0) {
      out[category] = channels;
    }
  }
  return out;
}

/**
 * F5-002.1 — allowlist defense for audit before/after.
 * Unknown keys are omitted; never mutates the input object.
 */
export function sanitizeAuditChanges(
  action: AuditAction,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
} {
  switch (action) {
    case 'boarding.board':
    case 'boarding.unboard':
      return { before: null, after: null };

    case 'trip.created':
    case 'trip.updated':
      return {
        before: pickAllowedKeys(before, TRIP_FIELDS),
        after: pickAllowedKeys(after, TRIP_FIELDS),
      };

    case 'trip.cancelled':
    case 'reservation.cancelled':
      return {
        before: pickAllowedKeys(before, STATUS_FIELDS),
        after: pickAllowedKeys(after, STATUS_FIELDS),
      };

    case 'reservation.created':
      return {
        before: pickAllowedKeys(before, RESERVATION_CREATED_FIELDS),
        after: pickAllowedKeys(after, RESERVATION_CREATED_FIELDS),
      };

    case 'agency_settings.updated':
      return {
        before: pickAllowedKeys(before, BRANDING_FIELDS),
        after: pickAllowedKeys(after, BRANDING_FIELDS),
      };

    case 'notification_preferences.updated':
      return {
        before: sanitizeNotificationPrefsDiff(before),
        after: sanitizeNotificationPrefsDiff(after),
      };

    case 'reservation_link.created':
    case 'reservation_link.cancelled':
    case 'reservation_link.confirmed':
    case 'reservation_link.regenerated':
    case 'reservation_link.passenger_data_saved':
    case 'reservation_link.expired':
      return {
        before: pickAllowedKeys(before, RESERVATION_LINK_FIELDS),
        after: pickAllowedKeys(after, RESERVATION_LINK_FIELDS),
      };

    default: {
      // Exhaustiveness: unknown action → empty diffs
      const _exhaustive: never = action;
      void _exhaustive;
      return { before: null, after: null };
    }
  }
}
