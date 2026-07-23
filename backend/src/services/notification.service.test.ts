import { describe, it, expect, vi, beforeEach } from 'vitest';

function createChainable(result: any = [], error: any = null) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: result, error }));
  chain.single = vi.fn(() => Promise.resolve({ data: result, error }));
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

import { notificationService } from './notification.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

function getInsertRows(): any[] {
  const chain = tableChains['notifications'];
  expect(chain.insert).toHaveBeenCalled();
  return chain.insert.mock.calls[0][0];
}

describe('notificationService.createNotification', () => {
  it('inserts a single notification with correct fields', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.createNotification({
      type: 'trip_cancelled',
      title: 'Viaje cancelado',
      body: 'El viaje Caracas → Valencia fue cancelado',
      entityType: 'trip',
      entityId: 'trip-123',
      agencyId: 'agency-456',
      recipientRole: 'agency',
    });

    expect(mockFrom).toHaveBeenCalledWith('notifications');
    const chain = tableChains['notifications'];
    expect(chain.insert).toHaveBeenCalled();
  });

  it('handles insert errors gracefully without throwing', async () => {
    tableChains['notifications'] = createChainable([], { message: 'DB error' });

    await expect(
      notificationService.createNotification({
        type: 'trip_cancelled',
        title: 'Test',
        body: 'Test body',
        entityType: 'trip',
        entityId: 'trip-1',
        recipientRole: 'agency',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('Targeting: actor = superadmin', () => {
  it('superadmin creates trip → agency rows only, NO superadmin row', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.createForAgenciesAndAdmin({
      type: 'trip_created',
      title: 'Viaje creado',
      body: 'Test body',
      entityType: 'trip',
      entityId: 'trip-1',
      agencyIds: ['agency-a', 'agency-b'],
      actor: 'superadmin',
    });

    const rows = getInsertRows();
    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.recipient_role === 'agency')).toBe(true);
    expect(rows.find((r: any) => r.recipient_role === 'superadmin')).toBeUndefined();
    expect(rows.map((r: any) => r.agency_id).sort()).toEqual(['agency-a', 'agency-b']);
  });

  it('superadmin cancels trip → agency rows only, NO superadmin row', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.createForAgenciesAndAdmin({
      type: 'trip_cancelled',
      title: 'Viaje cancelado',
      body: 'El viaje fue cancelado',
      entityType: 'trip',
      entityId: 'trip-2',
      agencyIds: ['agency-x'],
      actor: 'superadmin',
    });

    const rows = getInsertRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_role).toBe('agency');
    expect(rows[0].agency_id).toBe('agency-x');
  });

  it('superadmin creates trip with no agencies → no rows inserted', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.createForAgenciesAndAdmin({
      type: 'trip_created',
      title: 'Viaje creado',
      body: 'Test body',
      entityType: 'trip',
      entityId: 'trip-3',
      agencyIds: [],
      actor: 'superadmin',
    });

    const chain = tableChains['notifications'];
    expect(chain.insert).not.toHaveBeenCalled();
  });
});

describe('Targeting: actor = agency', () => {
  it('agency creates reservation → superadmin row only, NO agency row', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.createForAgency({
      type: 'reservation_created',
      title: 'Nueva reserva',
      body: 'Reserva de Juan — Caracas → Valencia',
      entityType: 'reservation',
      entityId: 'res-1',
      agencyId: 'agency-a',
      actor: 'agency',
    });

    const rows = getInsertRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_role).toBe('superadmin');
    expect(rows[0].agency_id).toBeNull();
  });

  it('agency cancels passenger → superadmin row only, NO agency row', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.createForAgency({
      type: 'passenger_cancelled',
      title: 'Pasajero cancelado',
      body: 'Pasajero María fue cancelado',
      entityType: 'passenger',
      entityId: 'pass-1',
      agencyId: 'agency-b',
      actor: 'agency',
    });

    const rows = getInsertRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_role).toBe('superadmin');
  });

  it('agency cancels reservation → superadmin row only, NO agency row', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.createForAgency({
      type: 'reservation_cancelled',
      title: 'Reserva cancelada',
      body: 'Reserva de Juan cancelada',
      entityType: 'reservation',
      entityId: 'res-2',
      agencyId: 'agency-a',
      actor: 'agency',
    });

    const rows = getInsertRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_role).toBe('superadmin');
  });
});

describe('Targeting: actor = system', () => {
  it('system auto-completes → agencies + superadmin both get rows', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.createForAgenciesAndAdmin({
      type: 'trip_auto_completed',
      title: 'Viaje completado automáticamente',
      body: 'El viaje fue completado automáticamente',
      entityType: 'trip',
      entityId: 'trip-4',
      agencyIds: ['agency-a', 'agency-b'],
      actor: 'system',
    });

    const rows = getInsertRows();
    expect(rows).toHaveLength(3);
    const agencyRows = rows.filter((r: any) => r.recipient_role === 'agency');
    const adminRow = rows.find((r: any) => r.recipient_role === 'superadmin');
    expect(agencyRows).toHaveLength(2);
    expect(adminRow).toBeDefined();
    expect(adminRow.agency_id).toBeNull();
  });
});

describe('Targeting: multi-tenant isolation', () => {
  it('Agency C does not receive notifications for a trip assigned to A and B', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.createForAgenciesAndAdmin({
      type: 'trip_created',
      title: 'Viaje creado',
      body: 'Test body',
      entityType: 'trip',
      entityId: 'trip-5',
      agencyIds: ['agency-a', 'agency-b'],
      actor: 'superadmin',
    });

    const rows = getInsertRows();
    const agencyIds = rows.map((r: any) => r.agency_id);
    expect(agencyIds).toContain('agency-a');
    expect(agencyIds).toContain('agency-b');
    expect(agencyIds).not.toContain('agency-c');
    expect(rows.find((r: any) => r.recipient_role === 'superadmin')).toBeUndefined();
  });

  it('Agency A does not receive notification for Agency B reservation', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.createForAgency({
      type: 'reservation_created',
      title: 'Nueva reserva',
      body: 'Reserva de Pedro',
      entityType: 'reservation',
      entityId: 'res-3',
      agencyId: 'agency-b',
      actor: 'agency',
    });

    const rows = getInsertRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_role).toBe('superadmin');
    expect(rows[0].agency_id).toBeNull();
  });
});

describe('notificationService.getAgencyNotifications', () => {
  it('returns notifications for the specified agency', async () => {
    const mockNotifications = [
      { id: 'n1', type: 'trip_cancelled', title: 'Test', agency_id: 'agency-1' },
    ];
    tableChains['notifications'] = createChainable(mockNotifications);

    const result = await notificationService.getAgencyNotifications('agency-1');

    expect(result).toEqual(mockNotifications);
    expect(mockFrom).toHaveBeenCalledWith('notifications');
  });

  it('throws on database error', async () => {
    tableChains['notifications'] = createChainable([], { message: 'DB error' });

    await expect(
      notificationService.getAgencyNotifications('agency-1'),
    ).rejects.toThrow('DB error');
  });
});

describe('notificationService.getAdminNotifications', () => {
  it('returns superadmin notifications', async () => {
    const mockNotifications = [
      { id: 'n1', type: 'trip_created', recipient_role: 'superadmin' },
    ];
    tableChains['notifications'] = createChainable(mockNotifications);

    const result = await notificationService.getAdminNotifications();

    expect(result).toEqual(mockNotifications);
  });
});

describe('notificationService.markAsRead', () => {
  it('updates read_at for the specified notification', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.markAsRead('n1', 'user-1', 'agency', 'agency-1');

    expect(mockFrom).toHaveBeenCalledWith('notifications');
  });

  it('throws on database error', async () => {
    tableChains['notifications'] = createChainable([], { message: 'Update failed' });

    await expect(
      notificationService.markAsRead('n1', 'user-1', 'agency', 'agency-1'),
    ).rejects.toThrow('Update failed');
  });
});

describe('notificationService.markAllAsRead', () => {
  it('updates all unread notifications for agency', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.markAllAsRead('user-1', 'agency', 'agency-1');

    expect(mockFrom).toHaveBeenCalledWith('notifications');
  });

  it('updates all unread notifications for superadmin', async () => {
    tableChains['notifications'] = createChainable();

    await notificationService.markAllAsRead('user-1', 'superadmin');

    expect(mockFrom).toHaveBeenCalledWith('notifications');
  });
});

describe('notificationService.getUnreadCount', () => {
  it('returns count for agency', async () => {
    const chain = createChainable();
    chain.then = vi.fn((resolve: any) => resolve({ data: null, error: null, count: 5 }));
    tableChains['notifications'] = chain;

    const count = await notificationService.getUnreadCount('agency', 'agency-1');

    expect(count).toBe(5);
  });

  it('returns count for superadmin', async () => {
    const chain = createChainable();
    chain.then = vi.fn((resolve: any) => resolve({ data: null, error: null, count: 12 }));
    tableChains['notifications'] = chain;

    const count = await notificationService.getUnreadCount('superadmin');

    expect(count).toBe(12);
  });

  it('throws on database error', async () => {
    tableChains['notifications'] = createChainable([], { message: 'Count failed' });

    await expect(
      notificationService.getUnreadCount('agency', 'agency-1'),
    ).rejects.toThrow('Count failed');
  });
});
