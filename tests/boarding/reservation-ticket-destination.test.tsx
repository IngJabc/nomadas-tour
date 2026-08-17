import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReservationTicket } from '@/components/reservations/ReservationTicket';
import type { ReservationTicketData } from '@/types/reservation';

vi.mock('react-qr-code', () => ({
  QRCode: ({ value }: { value: string }) => (
    <div data-testid="qr-code">{value}</div>
  ),
}));

const ticketFixture: ReservationTicketData = {
  reservation_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  qr_code: 'NT-TEST-QR',
  status: 'confirmed',
  created_at: '2026-08-17T12:00:00.000Z',
  booker_name: 'Ana Pérez',
  booker_document: 'V-12345678',
  trip: {
    id: 'trip-1',
    departure_time: '2026-08-20T14:00:00.000Z',
    origin: 'Barquisimeto',
    destination: 'Margarita',
    vehicle_type: 'bus',
    status: 'active',
  },
  passengers: [
    {
      id: 'pax-1',
      name: 'Ana Pérez',
      document: 'V-12345678',
      seat_code: 'A1',
      boarded: false,
    },
  ],
};

describe('ReservationTicket destination-only route', () => {
  it('shows destination and does not render origin on the ticket', () => {
    const { container } = render(
      <ReservationTicket reservation={ticketFixture} />,
    );

    expect(screen.getByText('Margarita')).toBeTruthy();
    expect(container.textContent).not.toContain('Barquisimeto');
    expect(container.textContent).not.toMatch(/Barquisimeto\s*→\s*Margarita/);
  });
});
