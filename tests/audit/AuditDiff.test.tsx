import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuditDiff } from '@/components/audit/AuditDiff';

describe('AuditDiff', () => {
  it('formats departure_time and vehicle_type', () => {
    render(
      <AuditDiff
        action="trip.updated"
        before={{
          departure_time: '2026-08-15T12:00:00.000Z',
          vehicle_type: 'bus',
        }}
        after={{
          departure_time: '2026-08-16T12:00:00.000Z',
          vehicle_type: 'kia',
        }}
      />,
    );
    expect(screen.getByText('Salida')).toBeTruthy();
    expect(screen.getByText('Autobús')).toBeTruthy();
    expect(screen.getByText('Kia')).toBeTruthy();
  });

  it('renders status badges and seat chips', () => {
    render(
      <AuditDiff
        action="reservation.cancelled"
        before={{ status: 'confirmed' }}
        after={{ status: 'cancelled' }}
      />,
    );
    expect(screen.getByText('confirmed')).toBeTruthy();
    expect(screen.getByText('cancelled')).toBeTruthy();

    render(
      <AuditDiff
        action="reservation.created"
        before={null}
        after={{ seat_codes: ['A1', 'A2'], passenger_count: 2 }}
      />,
    );
    expect(screen.getByText('A1')).toBeTruthy();
    expect(screen.getByText('A2')).toBeTruthy();
  });

  it('renders color swatches and unknown key fallback', () => {
    render(
      <AuditDiff
        action="agency_settings.updated"
        before={{ primary_color: '#000024', mystery_field: 'abc' }}
        after={{ primary_color: '#00D4FF', mystery_field: 'xyz' }}
      />,
    );
    expect(screen.getByText('Color primario')).toBeTruthy();
    expect(screen.getByText('Mystery Field')).toBeTruthy();
  });

  it('renders notification preference channels', () => {
    render(
      <AuditDiff
        action="notification_preferences.updated"
        before={{ occupancy_alerts: { in_app: true, email: true } }}
        after={{ occupancy_alerts: { in_app: true, email: false } }}
      />,
    );
    expect(screen.getByText('Alertas de ocupación')).toBeTruthy();
    expect(screen.getByText('Email')).toBeTruthy();
  });

  it('returns null for boarding and empty diffs', () => {
    const { container } = render(
      <AuditDiff action="boarding.board" before={null} after={null} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
