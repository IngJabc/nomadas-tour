import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * AS-TRIP-002 — "Completar viaje" desde la lista de viajes de la agencia.
 *
 * Cubre: visibilidad de la acción, confirmación previa, éxito con
 * refresco de la lista, errores 403 / 404 / 409 sin estado de éxito y
 * prevención de dobles envíos.
 */

const {
  mockGetTrips,
  mockGetTrip,
  mockCompleteTrip,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockGetTrips: vi.fn(),
  mockGetTrip: vi.fn(),
  mockCompleteTrip: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  agencyApi: {
    getTrips: () => mockGetTrips(),
    getTrip: (tripId: string) => mockGetTrip(tripId),
    completeTrip: (tripId: string) => mockCompleteTrip(tripId),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => ({
    user: { id: 'user-1', agency_id: 'agency-1', role: 'agency' },
  }),
}));

vi.mock('@/lib/realtime/subscriptions', () => ({
  subscribeToTripSeats: vi.fn(() => () => {}),
  subscribeToTripAgencies: vi.fn(() => () => {}),
  subscribeToTrips: vi.fn(() => () => {}),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import AgencyTripsContent from '@/app/agency/trips/AgencyTripsContent';
import { ApiError } from '@/lib/errors/api-error';

const PAST = new Date(Date.now() - 86_400_000).toISOString();

function tripFixture(partial: Record<string, unknown> = {}) {
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTrips.mockResolvedValue([tripFixture()]);
  mockCompleteTrip.mockResolvedValue({ id: 'trip-1', status: 'completed' });
});

describe('AgencyTripsContent — completar viaje (AS-TRIP-002)', () => {
  it('muestra la acción, pide confirmación y completa el viaje', async () => {
    mockGetTrips
      .mockResolvedValueOnce([tripFixture()])
      .mockResolvedValueOnce([tripFixture({ status: 'completed' })]);

    render(<AgencyTripsContent />);

    // 1) La acción aparece en la tarjeta del viaje exclusivo ya salido.
    const action = await screen.findByRole('button', {
      name: 'Completar viaje',
    });
    fireEvent.click(action);

    // 2) Confirmación que explica que el viaje quedará completado.
    expect(await screen.findByText('¿Completar viaje?')).toBeTruthy();
    expect(
      screen.getByText(/se marcará como completado/),
    ).toBeTruthy();
    expect(mockCompleteTrip).not.toHaveBeenCalled();

    // 3) Confirmar envía el PATCH con el id del viaje.
    fireEvent.click(screen.getByRole('button', { name: 'Sí, completar' }));

    await waitFor(() =>
      expect(mockCompleteTrip).toHaveBeenCalledWith('trip-1'),
    );
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Viaje completado correctamente',
      ),
    );
    expect(mockToastError).not.toHaveBeenCalled();

    // 4) La lista se refresca con el nuevo estado y el modal se cierra.
    await waitFor(() => expect(mockGetTrips).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText('¿Completar viaje?')).toBeNull(),
    );
  });

  it('cancelar la confirmación no llama al backend', async () => {
    render(<AgencyTripsContent />);

    const action = await screen.findByRole('button', {
      name: 'Completar viaje',
    });
    fireEvent.click(action);

    expect(await screen.findByText('¿Completar viaje?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));

    await waitFor(() =>
      expect(screen.queryByText('¿Completar viaje?')).toBeNull(),
    );
    expect(mockCompleteTrip).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('no ofrece la acción en un viaje compartido', async () => {
    mockGetTrips.mockResolvedValue([tripFixture({ agency_count: 2 })]);

    render(<AgencyTripsContent />);

    await screen.findByText('Mérida');
    expect(
      screen.queryByRole('button', { name: 'Completar viaje' }),
    ).toBeNull();
  });

  it('no ofrece la acción si el viaje aún no ha salido', async () => {
    mockGetTrips.mockResolvedValue([
      tripFixture({
        departure_time: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ]);

    render(<AgencyTripsContent />);

    await screen.findByText('Mérida');
    expect(
      screen.queryByRole('button', { name: 'Completar viaje' }),
    ).toBeNull();
  });

  it.each([
    [
      403,
      'No puedes completar este viaje: solo está disponible para viajes exclusivos de tu agencia y ya iniciados.',
    ],
    [
      404,
      'El viaje ya no existe o no está disponible. Actualiza la lista.',
    ],
    [
      409,
      'El viaje no se puede completar en este estado. Actualiza la lista e inténtalo de nuevo.',
    ],
  ])('maneja el error %i sin mostrar éxito', async (status, expectedMessage) => {
    mockCompleteTrip.mockRejectedValue(
      new ApiError('backend says no', 'FORBIDDEN', status),
    );

    render(<AgencyTripsContent />);

    const action = await screen.findByRole('button', {
      name: 'Completar viaje',
    });
    fireEvent.click(action);
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, completar' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(expectedMessage));

    // Nunca éxito, nunca refresh silencioso, modal disponible para reintentar.
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockGetTrips).toHaveBeenCalledTimes(1);
    expect(screen.getByText('¿Completar viaje?')).toBeTruthy();
  });

  it('previene dobles envíos mientras la petición está en curso', async () => {
    let resolveRequest: (value: unknown) => void = () => {};
    mockCompleteTrip.mockImplementation(
      () => new Promise((resolve) => { resolveRequest = resolve; }),
    );

    render(<AgencyTripsContent />);

    const action = await screen.findByRole('button', {
      name: 'Completar viaje',
    });
    fireEvent.click(action);
    const confirm = await screen.findByRole('button', {
      name: 'Sí, completar',
    });
    fireEvent.click(confirm);

    // El modal queda en estado de carga y deshabilitado, y el botón de
    // la tarjeta también: no puede lanzarse un segundo envío.
    const loadingModal = await screen.findByRole('button', {
      name: 'Cargando...',
    });
    expect((loadingModal as HTMLButtonElement).disabled).toBe(true);
    const cardAction = screen.getByRole('button', { name: 'Completar viaje' });
    expect((cardAction as HTMLButtonElement).disabled).toBe(true);

    // Clicks tardíos (en el DOM o por re-render) no generan otro request.
    fireEvent.click(loadingModal);
    fireEvent.click(cardAction);
    expect(mockCompleteTrip).toHaveBeenCalledTimes(1);

    resolveRequest({ id: 'trip-1', status: 'completed' });
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Viaje completado correctamente',
      ),
    );
  });

  it('muestra error genérico cuando la petición falla sin status conocido', async () => {
    mockCompleteTrip.mockRejectedValue(new Error('network down'));

    render(<AgencyTripsContent />);

    const action = await screen.findByRole('button', {
      name: 'Completar viaje',
    });
    fireEvent.click(action);
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, completar' }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        'No se pudo completar el viaje. Intenta de nuevo.',
      ),
    );
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});
