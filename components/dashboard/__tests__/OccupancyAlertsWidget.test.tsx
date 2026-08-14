import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OccupancyAlertsWidget } from '@/components/dashboard/OccupancyAlertsWidget';
import { OccupancyChart } from '@/components/dashboard/charts/OccupancyChart';

describe('F4-003 — OccupancyAlertsWidget', () => {
  it('shows empty state with CTA when there are no alerts', () => {
    render(<OccupancyAlertsWidget alerts={[]} />);

    expect(screen.getByText('Alertas de ocupación')).toBeTruthy();
    expect(screen.getByText('No hay alertas de ocupación')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Ver viajes/i }).getAttribute('href'),
    ).toBe('/agency/trips');
  });

  it('renders active alert fields and deep-links to passengers', () => {
    render(
      <OccupancyAlertsWidget
        alerts={[
          {
            trip_id: 'trip-1',
            alert_type: 'near_full',
            origin: 'Caracas',
            destination: 'Mérida',
            departure_time: '2026-08-20T12:00:00.000Z',
            occupancy_pct: 93,
            capacity: 10,
            reserved: 9,
            available: 1,
          },
        ]}
      />,
    );

    expect(screen.getByText('Casi lleno')).toBeTruthy();
    expect(screen.getByText('Mérida')).toBeTruthy();
    expect(screen.queryByText('Caracas → Mérida')).toBeNull();
    expect(screen.getByText('93%')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Ver viaje/i }).getAttribute('href'),
    ).toBe('/agency/trips/trip-1/passengers');
  });

  it('labels underbooked alerts as Pocas reservas', () => {
    render(
      <OccupancyAlertsWidget
        alerts={[
          {
            trip_id: 'trip-2',
            alert_type: 'underbooked',
            origin: 'Caracas',
            destination: 'Valencia',
            departure_time: '2026-08-21T12:00:00.000Z',
            occupancy_pct: 15,
            capacity: 10,
            reserved: 2,
            available: 8,
          },
        ]}
      />,
    );

    expect(screen.getByText('Pocas reservas')).toBeTruthy();
    expect(screen.getByText('Valencia')).toBeTruthy();
    expect(screen.queryByText(/Caracas/)).toBeNull();
  });

  it('keeps OccupancyChart available for admin composition', () => {
    render(
      <OccupancyChart
        data={[
          {
            trip_id: 'trip-admin',
            label: 'A → B',
            departure: '2026-08-20T12:00:00.000Z',
            total: 10,
            reserved: 5,
            occupancy_pct: 50,
          },
        ]}
      />,
    );

    expect(screen.getByText('Ocupación de viajes')).toBeTruthy();
  });
});
