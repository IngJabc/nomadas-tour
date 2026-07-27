import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetForAgency = vi.fn();
const mockGetForAgencies = vi.fn();

function createDefaultPreferences() {
  return {
    trip_assignments: { in_app_enabled: true, email_enabled: true },
    trip_schedule_changes: { in_app_enabled: true, email_enabled: true },
    trip_status_updates: { in_app_enabled: true, email_enabled: true },
    trip_cancellations: { in_app_enabled: true, email_enabled: true },
  };
}

vi.mock('./notification-preference.service.js', () => ({
  createDefaultPreferences: () => createDefaultPreferences(),
  notificationPreferenceService: {
    getForAgency: (...args: unknown[]) => mockGetForAgency(...args),
    getForAgencies: (...args: unknown[]) => mockGetForAgencies(...args),
  },
}));

import {
  isDeliveryEnabled,
  notificationDeliveryPolicy,
} from './notification-delivery.policy.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isDeliveryEnabled', () => {
  it('allows delivery by default for governed trip types', () => {
    const prefs = createDefaultPreferences();
    expect(isDeliveryEnabled(prefs as any, 'trip_created', 'in_app')).toBe(true);
    expect(isDeliveryEnabled(prefs as any, 'trip_created', 'email')).toBe(true);
  });

  it('blocks in-app delivery when category disabled', () => {
    const prefs = createDefaultPreferences();
    prefs.trip_assignments.in_app_enabled = false;
    expect(isDeliveryEnabled(prefs as any, 'trip_created', 'in_app')).toBe(false);
    expect(isDeliveryEnabled(prefs as any, 'trip_created', 'email')).toBe(true);
  });

  it('allows superadmin-only types regardless of prefs', () => {
    const prefs = createDefaultPreferences();
    prefs.trip_assignments.in_app_enabled = false;
    expect(isDeliveryEnabled(prefs as any, 'reservation_created', 'in_app')).toBe(true);
  });
});

describe('notificationDeliveryPolicy.shouldDeliver', () => {
  it('returns false when email channel is disabled', async () => {
    const prefs = createDefaultPreferences();
    prefs.trip_schedule_changes.email_enabled = false;
    mockGetForAgency.mockResolvedValue(prefs);

    const allowed = await notificationDeliveryPolicy.shouldDeliver(
      'agency-1',
      'trip_postponed',
      'email',
    );

    expect(allowed).toBe(false);
  });

  it('fails open when preference lookup throws', async () => {
    mockGetForAgency.mockRejectedValue(new Error('DB down'));

    const allowed = await notificationDeliveryPolicy.shouldDeliver(
      'agency-1',
      'trip_created',
      'email',
    );

    expect(allowed).toBe(true);
  });
});

describe('notificationDeliveryPolicy.filterAgencyNotificationRows', () => {
  it('filters disabled agency rows but keeps superadmin rows', async () => {
    const prefs = createDefaultPreferences();
    prefs.trip_assignments.in_app_enabled = false;
    mockGetForAgencies.mockResolvedValue(
      new Map([
        ['agency-a', prefs],
        ['agency-b', createDefaultPreferences()],
      ]),
    );

    const rows = [
      {
        type: 'trip_created' as const,
        recipient_role: 'agency' as const,
        agency_id: 'agency-a',
      },
      {
        type: 'trip_created' as const,
        recipient_role: 'agency' as const,
        agency_id: 'agency-b',
      },
      {
        type: 'trip_created' as const,
        recipient_role: 'superadmin' as const,
        agency_id: null,
      },
    ];

    const filtered =
      await notificationDeliveryPolicy.filterAgencyNotificationRows(rows);

    expect(filtered).toHaveLength(2);
    expect(filtered.map((row) => row.agency_id)).toEqual(['agency-b', null]);
  });

  it('fails open when bulk lookup throws', async () => {
    mockGetForAgencies.mockRejectedValue(new Error('DB down'));

    const rows = [
      {
        type: 'trip_created' as const,
        recipient_role: 'agency' as const,
        agency_id: 'agency-a',
      },
    ];

    const filtered =
      await notificationDeliveryPolicy.filterAgencyNotificationRows(rows);

    expect(filtered).toEqual(rows);
  });
});
