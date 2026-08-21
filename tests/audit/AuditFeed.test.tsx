import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuditEventDTO } from '@/types/audit';

const { mockListAudit } = vi.hoisted(() => ({
  mockListAudit: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  adminApi: {
    listAudit: (params?: unknown) => mockListAudit(params),
    listAgencies: vi.fn(async () => []),
    listRoutes: vi.fn(async () => []),
  },
  agencyApi: {
    listAudit: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { AuditFeed } from '@/components/audit/AuditFeed';

function item(id: string, occurred_at: string): AuditEventDTO {
  return {
    id,
    occurred_at,
    action: 'trip.created',
    entity_type: 'trip',
    entity_id: '11111111-1111-4111-8111-111111111111',
    agency_id: null,
    actor: null,
    before: null,
    after: { capacity: 31 },
    metadata: { source: 'api' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuditFeed', () => {
  it(
    'loads initial page ordered and supports load more + dedupe',
    async () => {
    mockListAudit
      .mockResolvedValueOnce({
        items: [
          item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '2026-08-15T12:00:00.000Z'),
          item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '2026-08-15T11:00:00.000Z'),
        ],
        next_cursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [
          item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '2026-08-15T11:00:00.000Z'),
          item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '2026-08-15T10:00:00.000Z'),
        ],
        next_cursor: null,
      });

    render(<AuditFeed role="superadmin" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('audit-event-card')).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole('button', { name: /Cargar más/i }));

    await waitFor(() => {
      expect(screen.getAllByTestId('audit-event-card')).toHaveLength(3);
    });
    expect(screen.getByText(/No hay más actividad/i)).toBeTruthy();
    expect(mockListAudit.mock.calls[1][0]).toMatchObject({
      cursor: 'cursor-1',
    });
    },
    15_000,
  );

  it('shows empty and error + retry', async () => {
    mockListAudit.mockResolvedValueOnce({ items: [], next_cursor: null });
    const { rerender } = render(<AuditFeed role="superadmin" />);
    await waitFor(() => {
      expect(
        screen.getByText(/No hay actividad registrada todavía/i),
      ).toBeTruthy();
    });

    mockListAudit.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/i }));
    await waitFor(() => {
      expect(screen.getByText(/No se pudo cargar la auditoría/i)).toBeTruthy();
    });

    mockListAudit.mockResolvedValueOnce({ items: [], next_cursor: null });
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    await waitFor(() => {
      expect(mockListAudit).toHaveBeenCalled();
    });
    rerender(<AuditFeed role="superadmin" />);
  });
});
