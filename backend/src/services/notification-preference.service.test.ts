import { describe, it, expect, vi, beforeEach } from 'vitest';

function createChainable(result: any = [], error: any = null) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.upsert = vi.fn(() => Promise.resolve({ error: null }));
  chain.then = vi.fn((resolve: any) => {
    const arr = Array.isArray(result) ? result : result ? [result] : [];
    resolve({ data: result, error, count: arr.length });
  });
  return chain;
}

const tableChains: Record<string, any> = {};

function buildTableChain(table: string) {
  if (!tableChains[table]) {
    tableChains[table] = createChainable();
  }
  return tableChains[table];
}

const mockFrom = vi.fn((table: string) => buildTableChain(table));

vi.mock('../config/database.js', () => ({
  get supabaseAdmin() {
    return { from: mockFrom };
  },
}));

import {
  createDefaultPreferences,
  notificationPreferenceService,
  toPublicCategories,
  toPublicPreferences,
} from './notification-preference.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('createDefaultPreferences', () => {
  it('enables all categories for both channels by default', () => {
    const prefs = createDefaultPreferences();
    expect(prefs.trip_assignments).toEqual({
      in_app_enabled: true,
      email_enabled: true,
    });
    expect(prefs.trip_cancellations).toEqual({
      in_app_enabled: true,
      email_enabled: true,
    });
    expect(prefs.trip_reminders).toEqual({
      in_app_enabled: true,
      email_enabled: true,
    });
    expect(prefs.ops_digest).toEqual({
      in_app_enabled: true,
      email_enabled: true,
    });
  });
});

describe('notificationPreferenceService.getForAgency', () => {
  it('returns defaults when no rows exist', async () => {
    tableChains['agency_notification_preferences'] = createChainable([]);

    const prefs = await notificationPreferenceService.getForAgency('agency-1');

    expect(prefs.trip_assignments.in_app_enabled).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('agency_notification_preferences');
  });

  it('merges stored rows over defaults', async () => {
    tableChains['agency_notification_preferences'] = createChainable([
      {
        category: 'trip_assignments',
        in_app_enabled: false,
        email_enabled: false,
      },
    ]);

    const prefs = await notificationPreferenceService.getForAgency('agency-1');

    expect(prefs.trip_assignments).toEqual({
      in_app_enabled: false,
      email_enabled: false,
    });
    expect(prefs.trip_schedule_changes.in_app_enabled).toBe(true);
  });
});

describe('notificationPreferenceService.getForAgencies', () => {
  it('returns empty map for empty input', async () => {
    const map = await notificationPreferenceService.getForAgencies([]);
    expect(map.size).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('loads preferences for multiple agencies', async () => {
    tableChains['agency_notification_preferences'] = createChainable([
      {
        agency_id: 'agency-a',
        category: 'trip_assignments',
        in_app_enabled: false,
        email_enabled: false,
      },
    ]);

    const map = await notificationPreferenceService.getForAgencies([
      'agency-a',
      'agency-b',
    ]);

    expect(map.get('agency-a')?.trip_assignments.in_app_enabled).toBe(false);
    expect(map.get('agency-b')?.trip_assignments.in_app_enabled).toBe(true);
  });
});

describe('notificationPreferenceService.seedDefaults', () => {
  it('upserts all default categories including trip_reminders and ops_digest', async () => {
    const chain = createChainable();
    chain.upsert = vi.fn(() => Promise.resolve({ error: null }));
    tableChains['agency_notification_preferences'] = chain;

    await notificationPreferenceService.seedDefaults('agency-new');

    expect(chain.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          agency_id: 'agency-new',
          category: 'trip_assignments',
          in_app_enabled: true,
          email_enabled: true,
        }),
        expect.objectContaining({
          agency_id: 'agency-new',
          category: 'trip_reminders',
          in_app_enabled: true,
          email_enabled: true,
        }),
        expect.objectContaining({
          agency_id: 'agency-new',
          category: 'ops_digest',
          in_app_enabled: true,
          email_enabled: true,
        }),
      ]),
      { onConflict: 'agency_id,category', ignoreDuplicates: true },
    );
    const rows = (chain.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(rows).toHaveLength(6);
  });
});

describe('notificationPreferenceService.updateForAgency', () => {
  it('rejects disabling locked categories', async () => {
    await expect(
      notificationPreferenceService.updateForAgency('agency-1', {
        trip_cancellations: false,
      }),
    ).rejects.toThrow('trip_cancellations cannot be disabled');
  });

  it('rejects unknown categories', async () => {
    await expect(
      notificationPreferenceService.updateForAgency('agency-1', {
        unknown_category: false,
      } as any),
    ).rejects.toThrow('Unknown notification category');
  });
});

describe('public preference mappers', () => {
  it('maps stored prefs to boolean API shape', () => {
    const prefs = createDefaultPreferences();
    prefs.trip_assignments.in_app_enabled = false;
    prefs.trip_assignments.email_enabled = false;

    expect(toPublicPreferences(prefs).trip_assignments).toBe(false);
    expect(toPublicPreferences(prefs).trip_cancellations).toBe(true);
  });

  it('includes category metadata and channel flags', () => {
    const prefs = createDefaultPreferences();
    const categories = toPublicCategories(prefs);

    expect(categories).toHaveLength(6);
    expect(categories[0]).toEqual(
      expect.objectContaining({
        key: 'trip_assignments',
        locked: false,
        channels: { in_app: true, email: true },
      }),
    );
    expect(categories.find((c) => c.key === 'trip_cancellations')?.locked).toBe(
      true,
    );
    expect(categories.find((c) => c.key === 'trip_reminders')).toEqual(
      expect.objectContaining({
        key: 'trip_reminders',
        locked: false,
        label: 'Recordatorios de viaje',
      }),
    );
    expect(categories.find((c) => c.key === 'ops_digest')).toEqual(
      expect.objectContaining({
        key: 'ops_digest',
        locked: false,
        label: 'Resumen operativo diario',
      }),
    );
  });
});
