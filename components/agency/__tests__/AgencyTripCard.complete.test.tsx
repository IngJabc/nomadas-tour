import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgencyTripCard, type AgencyTrip } from '@/components/agency/AgencyTripCard';

/**
 * AS-TRIP-002 — visibilidad de la acción "Completar viaje".
 *
 * La acción solo puede aparecer cuando el viaje:
 *   1. está activo (no completado ni cancelado),
 *   2. es exclusivo de la agencia (agency_count === 1),
 *   3. ya salió (el backend rechaza completar antes de la salida).
 *
 * Esto es SOLO visibilidad: la autorización real la decide el backend
 * en PATCH /api/agency/trips/:tripId/status.
 */

const PAST = new Date(Date.now() - 86_400_000).toISOString();
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

function tripFixture(partial: Partial<AgencyTrip> = {}): AgencyTrip {
  return {
    id: 'trip-1',
    route: { origin: 'Caracas', destination: 'Mérida' },
    departure_time: PAST,
    vehicle_type: 'bus',
    status: 'active',
    total_seats: 31,
    available_seats: 12,
    reserved_seats: 6,
    agency_count: 1,
    ...partial,
  };
}

describe('AgencyTripCard — "Completar viaje" (AS-TRIP-002)', () => {
  it('la muestra cuando el viaje es exclusivo, activo y ya salió', () => {
    const onComplete = vi.fn();
    render(<AgencyTripCard trip={tripFixture()} onComplete={onComplete} />);

    const button = screen.getByRole('button', { name: 'Completar viaje' });
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'trip-1' }),
    );
  });

  it('no la muestra en un viaje compartido (agency_count > 1)', () => {
    render(
      <AgencyTripCard
        trip={tripFixture({ agency_count: 2 })}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Completar viaje' })).toBeNull();
    // La navegación existente se conserva.
    expect(
      screen.queryByRole('link', { name: 'Ver pasajeros' }),
    ).toBeTruthy();
  });

  it('no la muestra si el viaje aún no ha salido', () => {
    render(
      <AgencyTripCard
        trip={tripFixture({ departure_time: FUTURE })}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Completar viaje' })).toBeNull();
  });

  it('no la muestra si el viaje ya está completado o cancelado', () => {
    const { rerender } = render(
      <AgencyTripCard
        trip={tripFixture({ status: 'completed' })}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Completar viaje' })).toBeNull();

    rerender(
      <AgencyTripCard
        trip={tripFixture({ status: 'cancelled' })}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Completar viaje' })).toBeNull();
  });

  it('no la muestra si el backend no informa la exclusividad (agency_count ausente)', () => {
    const partial: Partial<AgencyTrip> = { ...tripFixture() };
    delete partial.agency_count;

    render(<AgencyTripCard trip={partial as AgencyTrip} onComplete={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Completar viaje' })).toBeNull();
  });

  it('no la muestra sin callback onComplete (otros consumidores de la tarjeta)', () => {
    render(<AgencyTripCard trip={tripFixture()} />);

    expect(screen.queryByRole('button', { name: 'Completar viaje' })).toBeNull();
  });

  it('deshabilita el botón mientras la petición está en curso', () => {
    const onComplete = vi.fn();
    render(
      <AgencyTripCard
        trip={tripFixture()}
        onComplete={onComplete}
        completing
      />,
    );

    const button = screen.getByRole('button', { name: 'Completar viaje' });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(button);
    expect(onComplete).not.toHaveBeenCalled(); // sin doble envío
  });

  it('no anida el botón dentro del <Link> de la tarjeta', () => {
    render(<AgencyTripCard trip={tripFixture()} onComplete={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Completar viaje' });
    expect(button.closest('a')).toBeNull();
    // Sigue existiendo la navegación a pasajeros.
    expect(screen.getByRole('link', { name: 'Ver pasajeros' })).toBeTruthy();
  });
});
