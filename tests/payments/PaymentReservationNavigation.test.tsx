import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/** Timeout generoso: el suite completo ejecuta ~60 archivos en paralelo. */
const T = { timeout: 5000 };

const state = vi.hoisted(() => ({
  paramsId: 'pay-1',
}));

const { mockGetPayment, mockGetReservation, mockListPayments } = vi.hoisted(
  () => ({
    mockGetPayment: vi.fn(),
    mockGetReservation: vi.fn(),
    mockListPayments: vi.fn(),
  }),
);

vi.mock('@/lib/api', () => ({
  agencyApi: {
    getPayment: (...args: unknown[]) => mockGetPayment(...args),
    getReservation: (...args: unknown[]) => mockGetReservation(...args),
    listPayments: (...args: unknown[]) => mockListPayments(...args),
    cancelAgencyReservation: vi.fn(),
    cancelPassenger: vi.fn(),
  },
}));

vi.mock('@/lib/realtime/subscriptions', () => ({
  subscribeToReservations: () => () => {},
  subscribeToReservationPassengers: () => () => {},
  subscribeToBoardingLogs: () => () => {},
  subscribeToTrips: () => () => {},
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: state.paramsId }),
  useRouter: () => ({ push: vi.fn() }),
}));

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

vi.mock('@/hooks/useCapture', () => ({
  useCapture: () => ({
    captureRef: { current: null },
    capture: vi.fn(),
    download: vi.fn(),
    share: vi.fn(),
  }),
}));

vi.mock('@/lib/capture-reposition', () => ({
  withReposition: (_el: unknown, fn: () => unknown) => fn(),
}));

import PaymentDetailPage from '@/app/agency/payments/[id]/page';
import ReservationDetailPage from '@/app/agency/reservations/[id]/page';

/** UUIDs válidos RFC-4122 (versión 4, variante 8/9/a/b) para fixtures. */
const UUID_RES = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_PAY_1 = '11111111-1111-4111-8111-111111111111';
const UUID_PAY_2 = '22222222-2222-4222-8222-222222222222';
const UUID_PAY_P2_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const UUID_PAY_P2_B = 'bbbbbbbb-2222-4222-8222-222222222222';

const PAYMENT_DETAIL = {
  payment: {
    id: UUID_PAY_1,
    status: 'pending',
    amount_cents: 50000,
    currency: 'COP',
    submitted_at: '2026-10-01T12:00:00Z',
    verified_at: null,
    verified_by: null,
    rejection_reason: null,
    has_proof: false,
  },
  reservation: {
    id: UUID_RES,
    booker_name: 'Ana Pérez',
    booker_phone: null,
    contact_email: 'ana@example.com',
    status: 'confirmed',
    payment_status: 'pending',
    created_at: '2026-10-01T11:00:00Z',
  },
  trip: {
    id: 'trip-1',
    departure_time: '2026-10-15T07:00:00Z',
    vehicle_type: 'bus',
    seat_price: 25000,
    origin: 'Caracas',
    destination: 'Maracaibo',
  },
  passengers: [],
  allocations: [],
  totals: {
    active_passenger_count: 2,
    expected_cents: 50000,
    allocated_cents: 0,
    remaining_cents: 50000,
  },
};

const RESERVATION_RESPONSE = {
  reservation_id: UUID_RES,
  qr_code: 'QR-TEST-001',
  qr_data_url: '',
  status: 'confirmed',
  created_at: '2026-10-01T11:00:00Z',
  booker_name: 'Ana Pérez',
  booker_document: 'V-12345678',
  booker_phone: '04141234567',
  trip: {
    id: 'trip-1',
    departure_time: '2026-10-15T07:00:00Z',
    origin: 'Caracas',
    destination: 'Maracaibo',
    vehicle_type: 'bus',
    status: 'active',
    postponed_from: null,
  },
  passengers: [],
};

function makePaymentListItem(
  id: string,
  reservationId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    status: 'pending',
    amount_cents: 50000,
    currency: 'COP',
    submitted_at: '2026-10-01T12:00:00Z',
    verified_at: null,
    rejection_reason: null,
    has_proof: false,
    reservation: {
      id: reservationId,
      booker_name: 'Ana Pérez',
      contact_email: null,
      status: 'confirmed',
      payment_status: 'pending',
      trip: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.paramsId = 'pay-1';
});

describe('PaymentDetailPage — Ver reserva', () => {
  it('renderiza «Ver reserva» con destino correcto cuando hay reservation.id UUID válido', async () => {
    state.paramsId = 'pay-1';
    mockGetPayment.mockResolvedValue(PAYMENT_DETAIL);

    render(<PaymentDetailPage />);

    const link = await screen.findByRole('link', { name: /Ver reserva/ }, T);
    expect(link.getAttribute('href')).toBe(`/agency/reservations/${UUID_RES}`);
  });

  it('no renderiza «Ver reserva» cuando reservation.id está vacío', async () => {
    state.paramsId = 'pay-1';
    mockGetPayment.mockResolvedValue({
      ...PAYMENT_DETAIL,
      reservation: { ...PAYMENT_DETAIL.reservation, id: '' },
    });

    render(<PaymentDetailPage />);

    await screen.findByText('Verificar pago', undefined, T);
    expect(screen.queryByRole('link', { name: /Ver reserva/ })).toBeNull();
  });

  it('no renderiza «Ver reserva» cuando reservation.id no es un UUID válido', async () => {
    state.paramsId = 'pay-1';
    mockGetPayment.mockResolvedValue({
      ...PAYMENT_DETAIL,
      reservation: { ...PAYMENT_DETAIL.reservation, id: 'not-a-uuid' },
    });

    render(<PaymentDetailPage />);

    await screen.findByText('Verificar pago', undefined, T);
    expect(screen.queryByRole('link', { name: /Ver reserva/ })).toBeNull();
  });

  it('no rompe las acciones existentes de verificar/rechazar', async () => {
    state.paramsId = 'pay-1';
    mockGetPayment.mockResolvedValue(PAYMENT_DETAIL);

    render(<PaymentDetailPage />);

    expect(await screen.findByText('Verificar pago', undefined, T)).toBeTruthy();
    expect(screen.getByText('Rechazar pago')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Ver reserva/ }),
    ).toBeTruthy();
  });
});

describe('ReservationDetailPage — Ver pago', () => {
  it('muestra «Ver pago» con destino correcto cuando hay un pago UUID válido', async () => {
    state.paramsId = UUID_RES;
    mockGetReservation.mockResolvedValue(RESERVATION_RESPONSE);
    mockListPayments.mockResolvedValue({
      payments: [makePaymentListItem(UUID_PAY_1, UUID_RES)],
      page: 1,
      limit: 50,
      total: 1,
    });

    render(<ReservationDetailPage />);

    await waitFor(() => {
      expect(mockListPayments).toHaveBeenCalled();
    }, T);
    const link = await screen.findByRole('link', { name: /Ver pago/ }, T);
    expect(link.getAttribute('href')).toBe(`/agency/payments/${UUID_PAY_1}`);
  });

  it('enlaza al detalle de compra cuando el pago viene de MKT-007', async () => {
    state.paramsId = UUID_RES;
    mockGetReservation.mockResolvedValue(RESERVATION_RESPONSE);
    const UUID_ATTEMPT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    mockListPayments.mockResolvedValue({
      payments: [
        makePaymentListItem(UUID_PAY_1, UUID_RES, {
          checkout_attempt_id: UUID_ATTEMPT,
        }),
      ],
      page: 1,
      limit: 50,
      total: 1,
    });

    render(<ReservationDetailPage />);

    await waitFor(() => {
      expect(mockListPayments).toHaveBeenCalled();
    }, T);
    const link = await screen.findByRole('link', { name: /Ver pago/ }, T);
    expect(link.getAttribute('href')).toBe(
      `/agency/payments/attempts/${UUID_ATTEMPT}`,
    );
  });

  it('no muestra enlace de pago cuando no hay pagos', async () => {
    state.paramsId = UUID_RES;
    mockGetReservation.mockResolvedValue(RESERVATION_RESPONSE);
    mockListPayments.mockResolvedValue({
      payments: [],
      page: 1,
      limit: 50,
      total: 0,
    });

    render(<ReservationDetailPage />);

    await waitFor(() => {
      expect(mockListPayments).toHaveBeenCalled();
    }, T);
    expect(screen.queryByRole('link', { name: /Ver pago/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Pagos \(/ }),
    ).toBeNull();
    // Sin error y sin pagos: no debe mostrarse ni el estado de error ni el aviso truncado.
    expect(screen.queryByText(/No se pudieron cargar los pagos/)).toBeNull();
    expect(screen.queryByText(/Resultados limitados/)).toBeNull();
  });

  it('muestra Popover con todos los pagos cuando hay varios', async () => {
    state.paramsId = UUID_RES;
    mockGetReservation.mockResolvedValue(RESERVATION_RESPONSE);
    mockListPayments.mockResolvedValue({
      payments: [
        makePaymentListItem(UUID_PAY_1, UUID_RES),
        makePaymentListItem(UUID_PAY_2, UUID_RES, {
          status: 'verified',
          amount_cents: 30000,
        }),
      ],
      page: 1,
      limit: 50,
      total: 2,
    });

    render(<ReservationDetailPage />);

    await waitFor(() => {
      expect(mockListPayments).toHaveBeenCalled();
    }, T);
    const trigger = await screen.findByRole(
      'button',
      { name: /Pagos \(2\)/ },
      T,
    );

    fireEvent.click(trigger);

    const items = await screen.findAllByRole('menuitem', undefined, T);
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute('href')).toBe(`/agency/payments/${UUID_PAY_1}`);
    expect(items[1].getAttribute('href')).toBe(`/agency/payments/${UUID_PAY_2}`);
  });

  it('incluye pagos de páginas posteriores y termina correctamente', async () => {
    state.paramsId = UUID_RES;
    mockGetReservation.mockResolvedValue(RESERVATION_RESPONSE);

    mockListPayments.mockImplementation(
      ({ page }: { page: number; limit: number }) => {
        if (page === 1) {
          return Promise.resolve({
            payments: Array.from({ length: 50 }, (_, i) =>
              makePaymentListItem(`pay-other-${i}`, `other-res-${i}`),
            ),
            page: 1,
            limit: 50,
            total: 100,
          });
        }
        return Promise.resolve({
          payments: [
            makePaymentListItem(UUID_PAY_P2_A, UUID_RES),
            makePaymentListItem(UUID_PAY_P2_B, UUID_RES, {
              status: 'verified',
              amount_cents: 30000,
            }),
          ],
          page: 2,
          limit: 50,
          total: 100,
        });
      },
    );

    render(<ReservationDetailPage />);

    await waitFor(() => {
      expect(mockListPayments).toHaveBeenCalledWith({ page: 1, limit: 50 });
      expect(mockListPayments).toHaveBeenCalledWith({ page: 2, limit: 50 });
    }, T);

    const trigger = await screen.findByRole(
      'button',
      { name: /Pagos \(2\)/ },
      T,
    );

    fireEvent.click(trigger);

    const items = await screen.findAllByRole('menuitem', undefined, T);
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute('href')).toBe(
      `/agency/payments/${UUID_PAY_P2_A}`,
    );
    expect(items[1].getAttribute('href')).toBe(
      `/agency/payments/${UUID_PAY_P2_B}`,
    );
  });

  it('muestra estado de error y conserva el detalle si listPayments falla', async () => {
    state.paramsId = UUID_RES;
    mockGetReservation.mockResolvedValue(RESERVATION_RESPONSE);
    mockListPayments.mockRejectedValue(new Error('boom'));

    render(<ReservationDetailPage />);

    // El detalle de reserva sigue visible
    expect(
      await screen.findByRole(
        'heading',
        { name: /Reserva #aaaaaaaa/ },
        T,
      ),
    ).toBeTruthy();

    // El error NO se presenta como «cero pagos»: muestra el estado de error.
    expect(
      await screen.findByText(/No se pudieron cargar los pagos/, undefined, T),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Ver pago/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Pagos \(/ }),
    ).toBeNull();
  });

  it('muestra la advertencia de resultados limitados al alcanzar MAX_PAGES sin encontrar pagos', async () => {
    state.paramsId = UUID_RES;
    mockGetReservation.mockResolvedValue(RESERVATION_RESPONSE);

    // 20 páginas de 50 pagos sin coincidencia, total=5000 → nunca se llega al final.
    mockListPayments.mockImplementation(
      ({ page }: { page: number; limit: number }) =>
        Promise.resolve({
          payments: Array.from({ length: 50 }, (_, i) =>
            makePaymentListItem(`pay-x-${page}-${i}`, `other-res-${page}-${i}`),
          ),
          page,
          limit: 50,
          total: 5000,
        }),
    );

    render(<ReservationDetailPage />);

    // Debe detenerse en la página 20 (no bucle infinito) y mostrar el aviso.
    await waitFor(() => {
      expect(mockListPayments).toHaveBeenCalledTimes(20);
    }, T);

    const notice = await screen.findByText(/Resultados limitados/, undefined, T);
    expect(notice).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Ver pago/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Pagos \(/ }),
    ).toBeNull();
  });

  it('muestra la advertencia de resultados limitados aunque se hayan encontrado pagos', async () => {
    state.paramsId = UUID_RES;
    mockGetReservation.mockResolvedValue(RESERVATION_RESPONSE);

    // Página 1: 1 pago que coincide; total=2000 → quedan páginas potenciales.
    // Páginas 2..20: 50 pagos sin coincidencia cada una, total sigue en 2000.
    mockListPayments.mockImplementation(
      ({ page }: { page: number; limit: number }) => {
        if (page === 1) {
          return Promise.resolve({
            payments: [makePaymentListItem(UUID_PAY_1, UUID_RES)],
            page: 1,
            limit: 50,
            total: 2000,
          });
        }
        return Promise.resolve({
          payments: Array.from({ length: 50 }, (_, i) =>
            makePaymentListItem(`pay-y-${page}-${i}`, `other-${page}-${i}`),
          ),
          page,
          limit: 50,
          total: 2000,
        });
      },
    );

    render(<ReservationDetailPage />);

    await waitFor(() => {
      expect(mockListPayments).toHaveBeenCalledTimes(20);
    }, T);

    // El enlace SÍ aparece (se encontró 1 pago) y también la advertencia.
    const link = await screen.findByRole('link', { name: /Ver pago/ }, T);
    expect(link.getAttribute('href')).toBe(`/agency/payments/${UUID_PAY_1}`);
    expect(screen.getByText(/Resultados limitados/)).toBeTruthy();
  });

  it('no muestra la advertencia de resultados limitados si la paginación termina antes del límite', async () => {
    state.paramsId = UUID_RES;
    mockGetReservation.mockResolvedValue(RESERVATION_RESPONSE);

    // total=1 en la página 1 → se llega al final sin truncar.
    mockListPayments.mockResolvedValue({
      payments: [makePaymentListItem(UUID_PAY_1, UUID_RES)],
      page: 1,
      limit: 50,
      total: 1,
    });

    render(<ReservationDetailPage />);

    const link = await screen.findByRole('link', { name: /Ver pago/ }, T);
    expect(link).toBeTruthy();
    expect(screen.queryByText(/Resultados limitados/)).toBeNull();
    expect(mockListPayments).toHaveBeenCalledTimes(1);
  });

  it('un total inconsistente no causa bucle infinito ni afirma resultados completos', async () => {
    state.paramsId = UUID_RES;
    mockGetReservation.mockResolvedValue(RESERVATION_RESPONSE);

    // total crece y se contrae entre páginas; cada página devuelve 50 items.
    // El bucle debe detenerse en MAX_PAGES=20 y marcar truncated.
    const totals = [100, 5000, 80, 999999, 200, 40000];
    mockListPayments.mockImplementation(
      ({ page }: { page: number; limit: number }) =>
        Promise.resolve({
          payments: Array.from({ length: 50 }, (_, i) =>
            makePaymentListItem(`pay-z-${page}-${i}`, `other-z-${page}-${i}`),
          ),
          page,
          limit: 50,
          total: totals[(page - 1) % totals.length],
        }),
    );

    render(<ReservationDetailPage />);

    // Termina en 20 llamadas (prueba de que no hubo bucle infinito).
    await waitFor(() => {
      expect(mockListPayments).toHaveBeenCalledTimes(20);
    }, T);

    // No afirma completitud: muestra la advertencia de truncado.
    const notice = await screen.findByText(/Resultados limitados/, undefined, T);
    expect(notice).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Ver pago/ })).toBeNull();
  });

  it('no construye enlaces con IDs que no son UUIDs válidos', async () => {
    state.paramsId = UUID_RES;
    mockGetReservation.mockResolvedValue(RESERVATION_RESPONSE);
    mockListPayments.mockResolvedValue({
      payments: [makePaymentListItem('pay-1', UUID_RES)],
      page: 1,
      limit: 50,
      total: 1,
    });

    render(<ReservationDetailPage />);

    await waitFor(() => {
      expect(mockListPayments).toHaveBeenCalled();
    }, T);
    expect(screen.queryByRole('link', { name: /Ver pago/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Pagos \(/ }),
    ).toBeNull();
  });
});
