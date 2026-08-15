import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockGetForAgency = vi.fn();
const mockUpdateForAgency = vi.fn();

const ALL_CATEGORIES = [
  'trip_assignments',
  'trip_schedule_changes',
  'trip_status_updates',
  'trip_cancellations',
  'trip_reminders',
  'ops_digest',
  'occupancy_alerts',
] as const;

vi.mock('../services/notification-preference.service.js', () => ({
  notificationPreferenceService: {
    getForAgency: (...args: unknown[]) => mockGetForAgency(...args),
    updateForAgency: (...args: unknown[]) => mockUpdateForAgency(...args),
  },
  toPublicPreferences: (prefs: any) => {
    const out: Record<string, boolean> = {};
    for (const key of ALL_CATEGORIES) {
      out[key] = prefs[key].in_app_enabled;
    }
    return out;
  },
  toPublicCategories: (prefs: any) =>
    ALL_CATEGORIES.map((key) => ({
      key,
      label: key,
      description: 'Test',
      locked: false,
      channels: {
        in_app: prefs[key].in_app_enabled,
        email: prefs[key].email_enabled,
      },
    })),
}));

import { notificationPreferenceController } from '../controllers/notification-preference.controller.js';

function mockPrefs(overrides: Partial<Record<string, boolean>> = {}) {
  const enabled = (key: string) => overrides[key] ?? true;
  const build = (key: string) => ({
    in_app_enabled: enabled(key),
    email_enabled: enabled(key),
  });
  return {
    trip_assignments: build('trip_assignments'),
    trip_schedule_changes: build('trip_schedule_changes'),
    trip_status_updates: build('trip_status_updates'),
    trip_cancellations: build('trip_cancellations'),
    trip_reminders: build('trip_reminders'),
    ops_digest: build('ops_digest'),
    occupancy_alerts: build('occupancy_alerts'),
  };
}

function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    ctx: { agencyId: 'agency-1', userId: 'user-1', role: 'agency' },
    body,
    ip: '127.0.0.1',
    get: (name: string) =>
      name.toLowerCase() === 'user-agent' ? 'vitest' : undefined,
  } as unknown as Request;

  const json = vi.fn();
  const res = { json } as unknown as Response;
  const next = vi.fn() as NextFunction;

  return { req, res, next, json };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotificationPreferenceController.getPreferences', () => {
  it('returns preferences for agency from context', async () => {
    mockGetForAgency.mockResolvedValue(mockPrefs({ trip_assignments: false }));
    const { req, res, next, json } = createMockReqRes();

    await notificationPreferenceController.getPreferences(req, res, next);

    expect(mockGetForAgency).toHaveBeenCalledWith('agency-1');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          trip_assignments: false,
          trip_cancellations: true,
        }),
        categories: expect.any(Array),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('NotificationPreferenceController.updatePreferences', () => {
  it('updates preferences using agency from context', async () => {
    mockUpdateForAgency.mockResolvedValue(mockPrefs({ trip_assignments: false }));
    const { req, res, next, json } = createMockReqRes({
      trip_assignments: false,
    });

    await notificationPreferenceController.updatePreferences(req, res, next);

    expect(mockUpdateForAgency).toHaveBeenCalledWith(
      'agency-1',
      'user-1',
      {
        trip_assignments: false,
      },
      expect.objectContaining({ source: 'api' }),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ trip_assignments: false }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['trip_reminders', 'trip_reminders'],
    ['ops_digest', 'ops_digest'],
    ['occupancy_alerts', 'occupancy_alerts'],
  ])('accepts %s key and forwards the value', async (key) => {
    mockUpdateForAgency.mockResolvedValue(mockPrefs({ [key]: false }));
    const { req, res, next, json } = createMockReqRes({ [key]: false });

    await notificationPreferenceController.updatePreferences(req, res, next);

    expect(mockUpdateForAgency).toHaveBeenCalledWith(
      'agency-1',
      'user-1',
      {
        [key]: false,
      },
      expect.objectContaining({ source: 'api' }),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ [key]: false }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts all three newer keys in a single patch', async () => {
    mockUpdateForAgency.mockResolvedValue(
      mockPrefs({
        trip_reminders: false,
        ops_digest: false,
        occupancy_alerts: false,
      }),
    );
    const { req, res, next, json } = createMockReqRes({
      trip_reminders: false,
      ops_digest: false,
      occupancy_alerts: false,
    });

    await notificationPreferenceController.updatePreferences(req, res, next);

    expect(mockUpdateForAgency).toHaveBeenCalledWith(
      'agency-1',
      'user-1',
      {
        trip_reminders: false,
        ops_digest: false,
        occupancy_alerts: false,
      },
      expect.objectContaining({ source: 'api' }),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          trip_reminders: false,
          ops_digest: false,
          occupancy_alerts: false,
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects unknown fields', async () => {
    const { req, res, next } = createMockReqRes({
      trip_assignments: false,
      agency_id: 'evil-agency',
    });

    await notificationPreferenceController.updatePreferences(req, res, next);

    expect(mockUpdateForAgency).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('rejects empty patch body', async () => {
    const { req, res, next } = createMockReqRes({});

    await notificationPreferenceController.updatePreferences(req, res, next);

    expect(mockUpdateForAgency).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
