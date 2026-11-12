import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// El builder del modal encadena varias transiciones (AnimatePresence) y
// los timeouts de 5s por defecto se quedan cortos en las pruebas que
// recorren los 4 pasos.
vi.setConfig({ testTimeout: 20000 });

/**
 * AS-TRIP-003.1 — alta de viaje desde el panel de agencia en MODAL.
 *
 * Cubre: el CTA "Nuevo viaje" que ABRE EL MODAL sin navegar, carga del
 * catálogo global de rutas (`GET /api/agency/routes`), payload SIN agencia
 * (la asignación es del backend), validaciones de salida/vehículo/precio,
 * estados vacíos y de error, errores que mantienen el modal abierto sin
 * éxito falso, doble envío bloqueado y el refresco de la lista tras el
 * éxito. La página suelta `/agency/trips/new` fue eliminada.
 */

const {
  mockListRoutes,
  mockCreateTrip,
  mockGetTrips,
  mockGetTrip,
  mockCompleteTrip,
  mockAdminListRoutes,
  mockAdminListAgencies,
  mockToastSuccess,
  mockToastError,
  mockPush,
  mockReplace,
} = vi.hoisted(() => ({
  mockListRoutes: vi.fn(),
  mockCreateTrip: vi.fn(),
  mockGetTrips: vi.fn(),
  mockGetTrip: vi.fn(),
  mockCompleteTrip: vi.fn(),
  mockAdminListRoutes: vi.fn(),
  mockAdminListAgencies: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  agencyApi: {
    listRoutes: () => mockListRoutes(),
    createTrip: (data: unknown) => mockCreateTrip(data),
    getTrips: () => mockGetTrips(),
    getTrip: (tripId: string) => mockGetTrip(tripId),
    completeTrip: (tripId: string) => mockCompleteTrip(tripId),
  },
  // El builder de agencia NO debe tocar los endpoints del superadmin.
  adminApi: {
    listRoutes: () => mockAdminListRoutes(),
    listAgencies: () => mockAdminListAgencies(),
    createTrip: vi.fn(),
    updateTrip: vi.fn(),
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

// EmptyState y PageHeader usan <Link>; en jsdom no hay app router.
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

// El calendario real no es necesario: solo hace falta fijar la salida.
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

const ROUTE = {
  id: '3f1d2a4c-8b7e-4f9a-9c3d-1e2f3a4b5c6d',
  origin: 'Caracas',
  destination: 'Mérida',
  status: 'active' as const,
};

/** Salida local dos días en el futuro (formato naive del DateTimePicker). */
function futureDeparture(): string {
  const d = new Date(Date.now() + 2 * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T07:00`;
}

/** Abre el modal con el CTA de la lista. */
async function openBuilder() {
  const cta = await screen.findByRole('button', { name: 'Nuevo viaje' });
  fireEvent.click(cta);
  return await screen.findByRole('dialog', {}, { timeout: 5000 });
}

/** Ruta → Siguiente. */
async function stepRoute(routeId = ROUTE.id) {
  const select = await screen.findByRole('combobox', {}, { timeout: 5000 });
  fireEvent.change(select, { target: { value: routeId } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
}

/** Programación → Siguiente. */
async function stepSchedule(departure = futureDeparture()) {
  const input = await screen.findByTestId('departure-input', {}, { timeout: 5000 });
  fireEvent.change(input, { target: { value: departure } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
}

/** Vehículo + precio → Siguiente (llega a Revisión). */
async function stepVehicle(price = '250000') {
  const bus = await screen.findByRole('button', { name: /Autobús/ }, { timeout: 5000 });
  fireEvent.click(bus);
  fireEvent.change(screen.getByLabelText(/Precio por puesto/), {
    target: { value: price },
  });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
}

async function submitFromReview() {
  const submit = await screen.findByRole(
    'button',
    { name: /Crear viaje/ },
    { timeout: 5000 },
  );
  fireEvent.click(submit);
  return submit;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListRoutes.mockResolvedValue([ROUTE]);
  mockCreateTrip.mockResolvedValue({ id: 'trip-new', status: 'active' });
  mockGetTrips.mockResolvedValue([]);
  mockAdminListRoutes.mockResolvedValue([]);
  mockAdminListAgencies.mockResolvedValue([]);
});

describe('Nuevo viaje — modal desde la lista (AS-TRIP-003.1)', () => {
  it('el CTA abre el modal sin navegar fuera de la lista', async () => {
    render(<AgencyTripsContent />);

    await openBuilder();

    // Sin router.push/replace: el alta ya no es una página aparte.
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('carga el catálogo global desde /agency/routes y nunca los endpoints del admin', async () => {
    render(<AgencyTripsContent />);
    await openBuilder();

    await screen.findByRole('combobox', {}, { timeout: 5000 });

    expect(mockListRoutes).toHaveBeenCalledTimes(1);
    expect(mockAdminListRoutes).not.toHaveBeenCalled();
    expect(mockAdminListAgencies).not.toHaveBeenCalled();
  });

  it('crea el viaje sin enviar ninguna agencia, cierra, avisa y refresca la lista', async () => {
    render(<AgencyTripsContent />);
    await openBuilder();

    await stepRoute();
    await stepSchedule();
    await stepVehicle();
    await submitFromReview();

    await waitFor(
      () =>
        expect(mockCreateTrip).toHaveBeenCalledWith({
          route_id: ROUTE.id,
          departure_time: expect.any(String),
          vehicle_type: 'bus',
          seat_price: 25_000_000,
        }),
      { timeout: 5000 },
    );

    // El payload nunca lleva agencia: el backend la deriva de la sesión.
    const payload = mockCreateTrip.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain('agency_ids');
    expect(Object.keys(payload)).not.toContain('agency_id');
    expect(Object.keys(payload)).not.toContain('status');

    await waitFor(
      () =>
        expect(mockToastSuccess).toHaveBeenCalledWith(
          'Viaje creado correctamente',
        ),
      { timeout: 5000 },
    );
    expect(mockToastError).not.toHaveBeenCalled();
    // Sin navegación: el usuario queda en /agency/trips con la lista fresca.
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    // Cierra el modal y recarga la lista (carga inicial + refresh).
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), {
      timeout: 5000,
    });
    expect(mockGetTrips.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('sin rutas activas explica que la ruta se pide al superadmin y no ofrece selector de agencias', async () => {
    mockListRoutes.mockResolvedValue([]);
    render(<AgencyTripsContent />);
    await openBuilder();

    expect(
      await screen.findByText(/solicita al superadmin/, {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Crear viaje/ })).toBeNull();
    // Nunca hay paso de Agencias ni configuración de viaje compartido.
    expect(screen.queryByText(/Agencias/)).toBeNull();
    expect(mockCreateTrip).not.toHaveBeenCalled();
  });

  it('muestra error de carga del catálogo con reintentar dentro del modal', async () => {
    mockListRoutes.mockRejectedValueOnce(new Error('network down'));
    render(<AgencyTripsContent />);
    await openBuilder();

    expect(
      await screen.findByText(
        'No se pudieron cargar las rutas disponibles. Intenta de nuevo.',
        {},
        { timeout: 5000 },
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));

    await screen.findByRole('combobox', {}, { timeout: 5000 });
    expect(mockListRoutes).toHaveBeenCalledTimes(2);
    expect(mockCreateTrip).not.toHaveBeenCalled();
  });

  it('la revisión no muestra agencias ni campos de viaje compartido', async () => {
    render(<AgencyTripsContent />);
    await openBuilder();

    await stepRoute();
    await stepSchedule();
    await stepVehicle();

    expect(
      await screen.findByRole('button', { name: /Crear viaje/ }, { timeout: 5000 }),
    ).toBeTruthy();
    expect(screen.queryByText(/Agencias/)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('rechaza una salida en el pasado sin avanzar ni llamar al backend', async () => {
    render(<AgencyTripsContent />);
    await openBuilder();

    await stepRoute();

    const past = new Date(Date.now() - 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    await stepSchedule(
      `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T07:00`,
    );

    expect(
      await screen.findByText(/debe ser posterior a la fecha y hora actual/),
    ).toBeTruthy();
    // Sigue en Programación: el botón sigue siendo "Siguiente".
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeTruthy();
    expect(mockCreateTrip).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('exige el precio por puesto antes de pasar a revisión', async () => {
    render(<AgencyTripsContent />);
    await openBuilder();

    await stepRoute();
    await stepSchedule();

    const bus = await screen.findByRole('button', { name: /Autobús/ }, { timeout: 5000 });
    fireEvent.click(bus);
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

    expect(
      await screen.findByText(/El precio por puesto es obligatorio/),
    ).toBeTruthy();
    expect(mockCreateTrip).not.toHaveBeenCalled();
  });

  it('rechaza un precio no entero sin llamar al backend', async () => {
    render(<AgencyTripsContent />);
    await openBuilder();

    await stepRoute();
    await stepSchedule();

    const bus = await screen.findByRole('button', { name: /Autobús/ }, { timeout: 5000 });
    fireEvent.click(bus);
    fireEvent.change(screen.getByLabelText(/Precio por puesto/), {
      target: { value: '2500.50' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));

    // El mensaje vive en la ayuda del input y en la zona de validación.
    const priceErrors = await screen.findAllByText(
      /sin decimales ni puntos/,
      {},
      { timeout: 5000 },
    );
    expect(priceErrors.length).toBeGreaterThan(0);
    expect(mockCreateTrip).not.toHaveBeenCalled();
  });

  it('muestra el error del backend con el modal abierto, sin éxito ni navegación', async () => {
    mockCreateTrip.mockRejectedValue(
      new ApiError(
        'Ya existe un viaje programado para esta ruta en la fecha y hora seleccionadas.',
        'CONFLICT',
        409,
      ),
    );
    render(<AgencyTripsContent />);
    await openBuilder();

    await stepRoute();
    await stepSchedule();
    await stepVehicle();
    await submitFromReview();

    expect(
      await screen.findByText(/Ya existe un viaje programado/, {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    // El modal sigue abierto y el botón vuelve a habilitarse para reintentar.
    expect(screen.getByRole('dialog')).toBeTruthy();
    const submit = screen.getByRole('button', { name: /Crear viaje/ });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('muestra error genérico ante un fallo de red sin éxito', async () => {
    mockCreateTrip.mockRejectedValue(new Error('network down'));
    render(<AgencyTripsContent />);
    await openBuilder();

    await stepRoute();
    await stepSchedule();
    await stepVehicle();
    await submitFromReview();

    expect(
      await screen.findByText(
        'No se pudo crear el viaje. Intenta de nuevo.',
        {},
        { timeout: 5000 },
      ),
    ).toBeTruthy();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('bloquea dobles envíos mientras la petición está en curso', async () => {
    let resolveRequest: (value: unknown) => void = () => {};
    mockCreateTrip.mockImplementation(
      () => new Promise((resolve) => { resolveRequest = resolve; }),
    );
    render(<AgencyTripsContent />);
    await openBuilder();

    await stepRoute();
    await stepSchedule();
    await stepVehicle();

    const submit = await screen.findByRole(
      'button',
      { name: /Crear viaje/ },
      { timeout: 5000 },
    );
    fireEvent.click(submit);

    await waitFor(() => expect(mockCreateTrip).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });

    // El botón queda en loading/deshabilitado: un segundo click no envía.
    await waitFor(() => {
      const loading = screen.getByRole('button', { name: /Guardando/ });
      expect((loading as HTMLButtonElement).disabled).toBe(true);
    }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: /Guardando/ }));
    expect(mockCreateTrip).toHaveBeenCalledTimes(1);

    resolveRequest({ id: 'trip-new', status: 'active' });
    await waitFor(
      () => expect(mockToastSuccess).toHaveBeenCalled(),
      { timeout: 5000 },
    );
  });
});
