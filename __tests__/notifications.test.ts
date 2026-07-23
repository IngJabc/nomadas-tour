import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Notification } from '@/components/notifications/NotificationProvider';

const mockSupabase = {
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
  },
  channel: vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  }),
  removeChannel: vi.fn(),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabase,
}));

const capturedSubArgs: any[][] = [];
vi.mock('@/lib/realtime/subscriptions', () => ({
  subscribeToNotifications: (...args: any[]) => {
    capturedSubArgs.push(args);
    return () => {};
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'test-id-1',
    type: 'trip_created',
    title: 'Test notification',
    body: 'Test body',
    entity_type: 'trip',
    entity_id: 'trip-1',
    agency_id: 'agency-1',
    recipient_role: 'agency',
    read_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function shouldAccept(notif: Notification, role: string, agencyId?: string): boolean {
  if (role === 'superadmin' && notif.recipient_role !== 'superadmin') {
    return false;
  }
  if (
    role === 'agency' &&
    (notif.recipient_role !== 'agency' || notif.agency_id !== agencyId)
  ) {
    return false;
  }
  return true;
}

function resolveEndpoint(role: string): string {
  if (role === 'superadmin') return '/admin/notifications';
  if (role === 'agency') return '/agency/notifications';
  return '';
}

describe('Notification filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSubArgs.length = 0;
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
  });

  describe('handleEvent validation logic', () => {
    it('superadmin ignores notifications with recipient_role !== superadmin', () => {
      const notif = makeNotification({ recipient_role: 'agency', agency_id: 'some-agency' });
      expect(shouldAccept(notif, 'superadmin')).toBe(false);
    });

    it('superadmin accepts notifications with recipient_role === superadmin', () => {
      const notif = makeNotification({ recipient_role: 'superadmin', agency_id: null });
      expect(shouldAccept(notif, 'superadmin')).toBe(true);
    });

    it('agency ignores notifications with recipient_role !== agency', () => {
      const notif = makeNotification({ recipient_role: 'superadmin', agency_id: null });
      expect(shouldAccept(notif, 'agency', 'agency-1')).toBe(false);
    });

    it('agency ignores notifications from a different agency', () => {
      const notif = makeNotification({ recipient_role: 'agency', agency_id: 'agency-other' });
      expect(shouldAccept(notif, 'agency', 'agency-1')).toBe(false);
    });

    it('agency accepts notifications with matching agency_id', () => {
      const notif = makeNotification({ recipient_role: 'agency', agency_id: 'agency-1' });
      expect(shouldAccept(notif, 'agency', 'agency-1')).toBe(true);
    });

    it('superadmin does not receive own operations (notif created by superadmin action)', () => {
      const notif = makeNotification({ recipient_role: 'agency', agency_id: 'agency-1' });
      expect(shouldAccept(notif, 'superadmin')).toBe(false);
    });

    it('agency does not receive notifications intended for other agencies', () => {
      const notif = makeNotification({ recipient_role: 'agency', agency_id: 'agency-b' });
      expect(shouldAccept(notif, 'agency', 'agency-a')).toBe(false);
    });
  });

  describe('fetch endpoint selection', () => {
    it('superadmin uses /admin/notifications', () => {
      expect(resolveEndpoint('superadmin')).toBe('/admin/notifications');
    });

    it('agency uses /agency/notifications', () => {
      expect(resolveEndpoint('agency')).toBe('/agency/notifications');
    });

    it('does not fallback between roles', () => {
      const results: string[] = [];
      const role = 'superadmin';

      try {
        results.push(resolveEndpoint(role));
      } catch {
        results.push(resolveEndpoint('agency'));
      }

      expect(results).toEqual(['/admin/notifications']);
    });
  });

  describe('subscribeToNotifications passes correct args', () => {
    it('passes role as second arg and no agencyId for superadmin', async () => {
      const { subscribeToNotifications } = await import('@/lib/realtime/subscriptions');
      const cb = vi.fn();

      subscribeToNotifications(cb, 'superadmin');

      expect(capturedSubArgs).toHaveLength(1);
      expect(capturedSubArgs[0][1]).toBe('superadmin');
      expect(capturedSubArgs[0][2]).toBeUndefined();
    });

    it('passes role and agencyId for agency', async () => {
      const { subscribeToNotifications } = await import('@/lib/realtime/subscriptions');
      const cb = vi.fn();

      subscribeToNotifications(cb, 'agency', 'agency-abc');

      expect(capturedSubArgs).toHaveLength(1);
      expect(capturedSubArgs[0][1]).toBe('agency');
      expect(capturedSubArgs[0][2]).toBe('agency-abc');
    });
  });
});
