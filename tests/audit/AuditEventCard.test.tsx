import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AuditEventCard } from '@/components/audit/AuditEventCard';
import type { AuditEventDTO } from '@/types/audit';

const base: AuditEventDTO = {
  id: '44444444-4444-4444-8444-444444444444',
  occurred_at: '2026-08-15T12:00:00.000Z',
  action: 'reservation.created',
  entity_type: 'reservation',
  entity_id: '55555555-5555-4555-8555-555555555555',
  agency_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  actor: {
    user_id: '33333333-3333-4333-8333-333333333333',
    role: 'agency',
    agency_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
  before: null,
  after: { passenger_count: 2, seat_codes: ['A1', 'A2'] },
  metadata: { source: 'api' },
};

describe('AuditEventCard', () => {
  it('renders action, actor, entity and expands detail', () => {
    render(
      <AuditEventCard
        event={base}
        role="agency"
        agencyName="Agencia Central"
      />,
    );

    expect(screen.getByText('Reserva creada')).toBeTruthy();
    expect(screen.getByText(/Agencia Central · Agencia/)).toBeTruthy();
    expect(screen.getByText(/Reserva #555555/)).toBeTruthy();
    expect(screen.getByText(/2 pasajeros/)).toBeTruthy();

    const toggle = screen.getByRole('button', { name: /Ver detalle/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Usuario técnico')).toBeTruthy();
  });

  it('shows Sistema for null actor', () => {
    render(
      <AuditEventCard
        event={{ ...base, actor: null, action: 'trip.cancelled' }}
        role="superadmin"
      />,
    );
    expect(screen.getByText(/Sistema/)).toBeTruthy();
  });
});
