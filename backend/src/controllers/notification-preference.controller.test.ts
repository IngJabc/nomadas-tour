import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockGetForAgency = vi.fn();
const mockUpdateForAgency = vi.fn();

vi.mock('../services/notification-preference.service.js', () => ({
  notificationPreferenceService: {
    getForAgency: (...args: unknown[]) => mockGetForAgency(...args),
    updateForAgency: (...args: unknown[]) => mockUpdateForAgency(...args),
  },
  toPublicPreferences: (prefs: any) => ({
    trip_assignments: prefs.trip_assignments.in_app_enabled,
    trip_schedule_changes: prefs.trip_schedule_changes.in_app_enabled,
    trip_status_updates: prefs.trip_status_updates.in_app_enabled,
    trip_cancellations: prefs.trip_cancellations.in_app_enabled,
  }),
  toPublicCategories: (prefs: any) => [
    {
      key: 'trip_assignments',
      label: 'Nuevos viajes asignados',
      description: 'Test',
      locked: false,
      channels: {
        in_app: prefs.trip_assignments.in_app_enabled,
        email: prefs.trip_assignments.email_enabled,
      },
    },
  ],
}));

import { notificationPreferenceController } from '../controllers/notification-preference.controller.js';

function mockPrefs(overrides: Partial<Record<string, boolean>> = {}) {
  const enabled = (key: string) => overrides[key] ?? true;
  return {
    trip_assignments: {
      in_app_enabled: enabled('trip_assignments'),
      email_enabled: enabled('trip_assignments'),
    },
    trip_schedule_changes: {
      in_app_enabled: enabled('trip_schedule_changes'),
      email_enabled: enabled('trip_schedule_changes'),
    },
    trip_status_updates: {
      in_app_enabled: enabled('trip_status_updates'),
      email_enabled: enabled('trip_status_updates'),
    },
    trip_cancellations: {
      in_app_enabled: enabled('trip_cancellations'),
      email_enabled: enabled('trip_cancellations'),
    },
  };
}

function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    ctx: { agencyId: 'agency-1', userId: 'user-1', role: 'agency' },
    body,
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

    expect(mockUpdateForAgency).toHaveBeenCalledWith('agency-1', {
      trip_assignments: false,
    });
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({ trip_assignments: false }),
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
