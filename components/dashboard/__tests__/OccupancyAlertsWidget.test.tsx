import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OccupancyAlertsWidget } from '@/components/dashboard/OccupancyAlertsWidget';
import { OccupancyChart } from '@/components/dashboard/charts/OccupancyChart';

describe('F4-003 — OccupancyAlertsWidget', () => {
  it('shows empty state with CTA when there are no alerts', () => {
    render(<OccupancyAlertsWidget alerts={[]} />);

    expect(screen.getByText('Alertas de ocupación')).toBeInTheDocument();
    expect(screen.getByText('No hay alertas de ocupación')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver viajes/i })).toHaveAttribute(
      'href',
      '/agency/trips',
    );
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

    expect(screen.getByText('Casi lleno')).toBeInTheDocument();
    expect(screen.getByText('Caracas → Mérida')).toBeInTheDocument();
    expect(screen.getByText('93%')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver viaje/i })).toHaveAttribute(
      'href',
      '/agency/trips/trip-1/passengers',
    );
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

    expect(screen.getByText('Ocupación de viajes')).toBeInTheDocument();
  });
});
