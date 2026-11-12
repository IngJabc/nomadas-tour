import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// El builder del modal encadena varias transiciones (AnimatePresence) y
// los timeouts de 5s por defecto se quedan cortos en las pruebas que
// recorren los 4 pasos.
vi.setConfig({ testTimeout: 20000 });

/**
 * AS-TRIP-004 — edición de viajes propios desde `/agency/trips`.
 *
 * Cubre: visibilidad de la acción "Editar viaje" (solo viajes activos,
 * exclusivos de la agencia y aún no partidos), apertura del MODAL en modo
 * edición sin navegar, carga del viaje con `GET /api/agency/trips/:id` y
 * precarga de ruta/salida/vehículo/precio, envío por
 * `PATCH /api/agency/trips/:tripId` con SOLO los campos permitidos (nunca
 * agencia, estado ni endpoints del superadmin), éxito con cierre + toast +
 * refresco, errores que mantienen el modal abierto sin éxito falso, y
 * dobles envíos bloqueados. El backend sigue siendo la autoridad: aquí solo
 * se verifica el comportamiento de la UI.
 */

const {
  mockListRoutes,
  mockCreateTrip,
  mockUpdateTrip,
  mockGetTrips,
  mockGetTrip,
  mockCompleteTrip,
  mockAdminListRoutes,
  mockAdminListAgencies,
  mockAdminCreateTrip,
  mockAdminUpdateTrip,
  mockToastSuccess,
  mockToastError,
  mockPush,
  mockReplace,
} = vi.hoisted(() => ({
  mockListRoutes: vi.fn(),
  mockCreateTrip: vi.fn(),
  mockUpdateTrip: vi.fn(),
  mockGetTrips: vi.fn(),
  mockGetTrip: vi.fn(),
  mockCompleteTrip: vi.fn(),
  mockAdminListRoutes: vi.fn(),
  mockAdminListAgencies: vi.fn(),
  mockAdminCreateTrip: vi.fn(),
  mockAdminUpdateTrip: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  agencyApi: {
    listRoutes: () => mockListRoutes(),
    createTrip: (data: unknown) => mockCreateTrip(data),
    updateTrip: (tripId: string, data: unknown) => mockUpdateTrip(tripId, data),
    getTrips: () => mockGetTrips(),
    getTrip: (tripId: string) => mockGetTrip(tripId),
    completeTrip: (tripId: string) => mockCompleteTrip(tripId),
  },
  // La edición de agencia NO debe tocar los endpoints del superadmin.
  adminApi: {
    listRoutes: () => mockAdminListRoutes(),
    listAgencies: () => mockAdminListAgencies(),
    createTrip: (data: unknown) => mockAdminCreateTrip(data),
    updateTrip: (tripId: string, data: unknown) => mockAdminUpdateTrip(tripId, data),
    getTrip: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}));

// EmptyState, PageHeader y la tarjeta usan <Link>; en jsdom no hay app router.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// El calendario real no es necesario: solo hace falta leer la salida precargada.
vi.mock('@/components/ui/DateTimePicker', () => ({
  DateTimePicker: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
  }) => (
    <input
      data-testid="departure-input"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
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

import AgencyTripsContent from '@/app/agency/trips/AgencyTripsContent';
import { ApiError } from '@/lib/errors/api-error';
import { fromUTCToLocal } from '@/lib/timezone';

const ROUTE = {
  id: '3f1d2a4c-8b7e-4f9a-9c3d-1e2f3a4b5c6d',
  origin: 'Caracas',
  destination: 'Mérida',
  status: 'active' as const,
};

const FUTURE_UTC = new Date(Date.now() + 2 * 86_400_000).toISOString();
const PAST_UTC = new Date(Date.now() - 86_400_000).toISOString();

/** Salida local naive que precarga el modal (misma conversión que la UI). */
const EXPECTED_DEPARTURE = fromUTCToLocal(FUTURE_UTC);

/** Renglón de la lista (misma forma que GET /api/agency/trips). */
function tripFixture(partial: Record<string, unknown> = {}) {
  return {
    id: 'trip-1',
    route: { origin: 'Caracas', destination: 'Mérida' },
    departure_time: FUTURE_UTC,
    vehicle_type: 'bus',
    status: 'active',
    total_seats: 31,
    available_seats: 31,
    reserved_seats: 0,
    agency_count: 1,
    ...partial,
  };
}

/** Detalle completo (GET /api/agency/trips/:id) con los campos editables. */
function tripDetail(partial: Record<string, unknown> = {}) {
  return {
    id: 'trip-1',
    route_id: ROUTE.id,
    departure_time: FUTURE_UTC,
    vehicle_type: 'bus',
    status: 'active',
    capacity: 31,
    seat_price: 25_000_000,
    routes: { origin: 'Caracas', destination: 'Mérida' },
    seats: [],
    allocations: [],
    ...partial,
  };
}

/** Abre el modal de edición desde la tarjeta del viaje. */
async function openEdit() {
  const action = await screen.findByRole('button', { name: 'Editar viaje' });
  fireEvent.click(action);
  return await screen.findByRole('dialog', {}, { timeout: 5000 });
}

/**
 * Recorre los 4 pasos SIN tocar nada: si la precarga fallara (ruta,
 * salida, vehículo o precio vacíos) `Siguiente` no avanzaría.
 * Termina en Revisión, listo para enviar.
 */
async function gotoReview() {
  const combobox = await screen.findByRole('combobox', {}, { timeout: 5000 });
  expect((combobox as HTMLSelectElement).value).toBe(ROUTE.id);
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

  const departure = await screen.findByTestId('departure-input', {}, {
    timeout: 5000,
  });
  expect((departure as HTMLInputElement).value).toBe(EXPECTED_DEPARTURE);
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

  const price = await screen.findByLabelText(/Precio por puesto/, {}, {
    timeout: 5000,
  });
  expect((price as HTMLInputElement).value).toBe('250000');
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

  // Revisión: el vehículo precargado se resume aquí (si estuviera vacío
  // no se habría podido avanzar desde el paso de vehículo).
  expect(
    await screen.findByText('Autobús (31 puestos)', {}, { timeout: 5000 }),
  ).toBeTruthy();
}

async function submitFromReview() {
  const submit = await screen.findByRole(
    'button',
    { name: 'Guardar cambios' },
    { timeout: 5000 },
  );
  fireEvent.click(submit);
  return submit;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListRoutes.mockResolvedValue([ROUTE]);
  mockCreateTrip.mockResolvedValue({ id: 'trip-new', status: 'active' });
  mockUpdateTrip.mockResolvedValue({ id: 'trip-1', status: 'active' });
  mockGetTrips.mockResolvedValue([tripFixture()]);
  mockGetTrip.mockResolvedValue(tripDetail());
  mockCompleteTrip.mockResolvedValue({ id: 'trip-1', status: 'completed' });
  mockAdminListRoutes.mockResolvedValue([]);
  mockAdminListAgencies.mockResolvedValue([]);
});

describe('Visibilidad de "Editar viaje" (AS-TRIP-004)', () => {
  it('se muestra en un viaje activo, exclusivo y aún no partido', async () => {
    render(<AgencyTripsContent />);

    expect(
      await screen.findByRole('button', { name: 'Editar viaje' }),
    ).toBeTruthy();
  });

  it('no se muestra en un viaje COMPARTIDO (dos agencias)', async () => {
    mockGetTrips.mockResolvedValue([tripFixture({ agency_count: 2 })]);

    render(<AgencyTripsContent />);

    await screen.findByText('Mérida');
    expect(
      screen.queryByRole('button', { name: 'Editar viaje' }),
    ).toBeNull();
  });

  it('no se muestra si la salida ya pasó (ofrece completar en su lugar)', async () => {
    mockGetTrips.mockResolvedValue([tripFixture({ departure_time: PAST_UTC })]);

    render(<AgencyTripsContent />);

    await screen.findByText('Mérida');
    expect(
      screen.queryByRole('button', { name: 'Editar viaje' }),
    ).toBeNull();
    // Mutuamente exclusivo con "Completar viaje": salida pasada.
    expect(
      screen.getByRole('button', { name: 'Completar viaje' }),
    ).toBeTruthy();
  });

  it.each([
    ['completed', 'Completados'],
    ['cancelled', 'Cancelados'],
  ])(
    'no se muestra en un viaje %s',
    async (status, tabLabel) => {
      mockGetTrips.mockResolvedValue([tripFixture({ status })]);

      render(<AgencyTripsContent />);

      // El filtro por defecto es "Programados": cambiar a ver todos.
      fireEvent.click(await screen.findByRole('button', { name: 'Todos' }));
      await screen.findByText('Mérida');
      expect(
        screen.queryByRole('button', { name: 'Editar viaje' }),
      ).toBeNull();
      void tabLabel;
    },
  );
});

describe('Modal de edición (AS-TRIP-004)', () => {
  it('abre el MODAL en modo edición sin navegar y carga el viaje por su id', async () => {
    render(<AgencyTripsContent />);

    await openEdit();

    // Título del modo edición y datos del viaje pedidos por id.
    expect(
      await screen.findByRole('heading', { name: 'Editar viaje' }, {
        timeout: 5000,
      }),
    ).toBeTruthy();
    expect(mockGetTrip).toHaveBeenCalledWith('trip-1');

    // Sin navegación: el usuario sigue en /agency/trips.
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    // Nunca se abre el builder de creación mientras se edita.
    expect(screen.queryByRole('button', { name: 'Crear viaje' })).toBeNull();
  });

  it('precarga ruta, salida, vehículo y precio del viaje existente', async () => {
    render(<AgencyTripsContent />);

    await openEdit();
    await gotoReview();

    // La revisión resume lo precargado y NUNCA ofrece agencias ni
    // configuración de viaje compartido.
    expect(screen.getByText('Caracas → Mérida')).toBeTruthy();
    expect(screen.getByText('Autobús (31 puestos)')).toBeTruthy();
    expect(screen.queryByText(/Agencias/)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('envía el PATCH con solo los campos permitidos y nunca crea ni usa endpoints del admin', async () => {
    render(<AgencyTripsContent />);

    await openEdit();
    await gotoReview();
    await submitFromReview();

    await waitFor(
      () =>
        expect(mockUpdateTrip).toHaveBeenCalledWith('trip-1', {
          route_id: ROUTE.id,
          departure_time: EXPECTED_DEPARTURE,
          vehicle_type: 'bus',
          seat_price: 25_000_000,
        }),
      { timeout: 5000 },
    );

    // El payload nunca lleva agencia, estado ni campos prohibidos.
    const payload = mockUpdateTrip.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain('agency_ids');
    expect(Object.keys(payload)).not.toContain('agency_id');
    expect(Object.keys(payload)).not.toContain('status');
    expect(Object.keys(payload)).not.toContain('postpone');

    // Nunca el alta ni los endpoints del superadmin.
    expect(mockCreateTrip).not.toHaveBeenCalled();
    expect(mockAdminCreateTrip).not.toHaveBeenCalled();
    expect(mockAdminUpdateTrip).not.toHaveBeenCalled();
    expect(mockAdminListRoutes).not.toHaveBeenCalled();
    expect(mockAdminListAgencies).not.toHaveBeenCalled();
  });

  it('al éxito cierra el modal, avisa y refresca la lista', async () => {
    render(<AgencyTripsContent />);

    await openEdit();
    await gotoReview();
    await submitFromReview();

    await waitFor(
      () =>
        expect(mockToastSuccess).toHaveBeenCalledWith(
          'Viaje actualizado correctamente',
        ),
      { timeout: 5000 },
    );
    expect(mockToastError).not.toHaveBeenCalled();
    // Nunca el mensaje de creación mientras se edita.
    expect(mockToastSuccess).not.toHaveBeenCalledWith(
      'Viaje creado correctamente',
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), {
      timeout: 5000,
    });
    // Carga inicial + refresco posterior al éxito.
    expect(mockGetTrips.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Sin navegación fuera de la lista.
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('mantiene el modal abierto con el error del backend (409) y reintento habilitado', async () => {
    mockUpdateTrip.mockRejectedValue(
      new ApiError(
        'Ya existe un viaje programado para esta ruta en la fecha y hora seleccionadas.',
        'CONFLICT',
        409,
      ),
    );

    render(<AgencyTripsContent />);

    await openEdit();
    await gotoReview();
    await submitFromReview();

    expect(
      await screen.findByText(/Ya existe un viaje programado/, {}, {
        timeout: 5000,
      }),
    ).toBeTruthy();

    // Sin éxito falso, sin refresh, modal disponible para reintentar.
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockGetTrips).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Guardar cambios' });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('muestra el mensaje de autorización del backend (403) sin cerrar el modal', async () => {
    mockUpdateTrip.mockRejectedValue(
      new ApiError('El viaje no pertenece en exclusiva a esta agencia', 'FORBIDDEN', 403),
    );

    render(<AgencyTripsContent />);

    await openEdit();
    await gotoReview();
    await submitFromReview();

    expect(
      await screen.findByText(
        'No puedes editar este viaje. Solo se permiten viajes exclusivos de tu agencia y aún sin reservas.',
        {},
        { timeout: 5000 },
      ),
    ).toBeTruthy();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('muestra error genérico ante un fallo de red sin éxito', async () => {
    mockUpdateTrip.mockRejectedValue(new Error('network down'));

    render(<AgencyTripsContent />);

    await openEdit();
    await gotoReview();
    await submitFromReview();

    expect(
      await screen.findByText(
        'No se pudieron guardar los cambios. Intenta de nuevo.',
        {},
        { timeout: 5000 },
      ),
    ).toBeTruthy();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('bloquea dobles envíos mientras la petición está en curso', async () => {
    let resolveRequest: (value: unknown) => void = () => {};
    mockUpdateTrip.mockImplementation(
      () => new Promise((resolve) => { resolveRequest = resolve; }),
    );

    render(<AgencyTripsContent />);

    await openEdit();
    await gotoReview();
    const submit = await submitFromReview();

    await waitFor(() => expect(mockUpdateTrip).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });

    // El botón queda en loading/deshabilitado: un segundo click no envía.
    const loading = await screen.findByRole('button', { name: /Guardando/ }, {
      timeout: 5000,
    });
    expect((loading as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(loading);
    fireEvent.click(submit);
    expect(mockUpdateTrip).toHaveBeenCalledTimes(1);

    resolveRequest({ id: 'trip-1' });
    await waitFor(
      () => expect(mockToastSuccess).toHaveBeenCalled(),
      { timeout: 5000 },
    );
  });

  it('si falla la carga del viaje muestra reintentar dentro del modal', async () => {
    mockGetTrip.mockRejectedValueOnce(new Error('network down'));

    render(<AgencyTripsContent />);

    await openEdit();

    expect(
      await screen.findByText(
        'No se pudo cargar el viaje a editar. Intenta de nuevo.',
        {},
        { timeout: 5000 },
      ),
    ).toBeTruthy();
    expect(mockUpdateTrip).not.toHaveBeenCalled();

    // Reintentar recarga el viaje sin cerrar el modal.
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));

    await screen.findByRole('combobox', {}, { timeout: 5000 });
    expect(mockGetTrip).toHaveBeenCalledTimes(2);
    expect(mockUpdateTrip).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
