import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * RT-06 — Realtime de /agency/payments (comportamiento).
 *
 * Los canales se registran en `rt` (mock de @/lib/realtime/subscriptions):
 * cada llamada expone onChange (evento) y options.onStatus (estado del
 * canal), devolviendo su cleanup. Los timers son reales: el debounce es
 * 500 ms y el min-gap 700 ms (los waits usan timeout explícito).
 */

type RtCall = {
  table: string;
  onChange: () => void;
  options: Record<string, unknown> | undefined;
  removed: boolean;
};

const { mockListCheckoutAttempts, mockGetPayment, mockGetCheckoutAttempt, rt, params } =
  vi.hoisted(() => {
    type Call = {
      table: string;
      onChange: () => void;
      options: Record<string, unknown> | undefined;
      removed: boolean;
    };
    const rt: { calls: Call[]; reset: () => void } = {
      calls: [],
      reset: () => {
        rt.calls = [];
      },
    };
    const params = { id: 'attempt-1' };
    return {
      mockListCheckoutAttempts: vi.fn(),
      mockGetPayment: vi.fn(),
      mockGetCheckoutAttempt: vi.fn(),
      rt,
      params,
    };
  });

vi.mock('@/lib/api', () => ({
  agencyApi: {
    listPayments: vi.fn(),
    getPayment: (...args: unknown[]) => mockGetPayment(...args),
    getPaymentProof: vi.fn(),
    verifyPayment: vi.fn(),
    rejectPayment: vi.fn(),
    listCheckoutAttempts: (...args: unknown[]) =>
      mockListCheckoutAttempts(...args),
    getCheckoutAttempt: (...args: unknown[]) => mockGetCheckoutAttempt(...args),
    getCheckoutAttemptProof: vi.fn(),
    verifyCheckoutAttempt: vi.fn(),
    rejectCheckoutAttempt: vi.fn(),
  },
}));

vi.mock('@/lib/realtime/subscriptions', () => {
  const track =
    (table: string) =>
    (onChange: () => void, options?: Record<string, unknown>) => {
      const call: RtCall = { table, onChange, options, removed: false };
      rt.calls.push(call);
      return () => {
        call.removed = true;
      };
    };
  return {
    subscribeToAgencyCheckoutAttempts: track('checkout_attempts'),
    subscribeToAgencyPayments: track('payments'),
    subscribeToAgencyPaymentReservation: track('reservations'),
    subscribeToAgencyPaymentPassengers: track('reservation_passengers'),
  };
});

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => ({
    user: {
      id: 'user-1',
      email: 'agencia@example.com',
      role: 'agency',
      agency_id: 'agency-1',
      agency_name: 'Agencia Central',
    },
    loading: false,
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: params.id }),
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

import AgencyPaymentsPage from '@/app/agency/payments/page';
import PaymentDetailPage from '@/app/agency/payments/[id]/page';
import CheckoutAttemptDetailPage from '@/app/agency/payments/attempts/[id]/page';
import {
  PAYMENT_STATUS_LABELS,
  CHECKOUT_ATTEMPT_STATUS_LABELS,
} from '@/lib/payments';

const W = { timeout: 3000 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ATTEMPT_ITEM = {
  id: 'attempt-1',
  status: 'pending_review',
  amount_cents: 50000,
  passenger_count: 2,
  proof_count: 1,
  has_proof: true,
  payment_reference: '00123456789',
  bank_origin: 'Banco de Venezuela',
  submitted_at: '2026-10-01T12:00:00Z',
  rejection_reason: null,
  expires_at: '2026-10-02T12:00:00Z',
  created_at: '2026-10-01T11:00:00Z',
  booker: { name: 'Ana Pérez', document: '12345678', phone: '04141234567' },
  trip: {
    id: 'trip-1',
    departure_time: '2026-10-15T07:00:00Z',
    origin: 'Caracas',
    destination: 'Maracaibo',
  },
};

const ATTEMPT_DETAIL = {
  attempt: {
    id: 'attempt-1',
    status: 'pending_review',
    reservation_id: null,
    amount_cents: 50000,
    unit_price: 25000,
    passenger_count: 2,
    proof_count: 1,
    remaining_submissions: 2,
    payment_reference: '00123456789',
    bank_origin: 'Banco de Venezuela',
    payment_datetime: '2026-10-01T10:00:00Z',
    proof_submitted_at: '2026-10-01T12:00:00Z',
    review_started_at: '2026-10-01T12:00:00Z',
    rejection_reason: null,
    rejection_count: 0,
    expires_at: '2026-10-02T12:00:00Z',
    created_at: '2026-10-01T11:00:00Z',
    closed_at: null,
    verified_at: null,
    verified_by: null,
    has_proof: true,
    payment_method_id: null,
    payment_method_snapshot: null,
  },
  trip: {
    id: 'trip-1',
    departure_time: '2026-10-15T07:00:00Z',
    vehicle_type: 'bus',
    seat_price: 25000,
    origin: 'Caracas',
    destination: 'Maracaibo',
  },
  passengers: [
    {
      seat_id: 'seat-1',
      seat_code: 'A1',
      first_name: 'Ana',
      last_name: 'Pérez',
      name: 'Ana Pérez',
      document: '12345678',
      phone: '04141234567',
    },
  ],
  history: [],
};

const PAYMENT_DETAIL = {
  payment: {
    id: 'pay-1',
    status: 'pending',
    amount_cents: 50000,
    currency: 'COP',
    submitted_at: '2026-10-01T12:00:00Z',
    verified_at: null,
    verified_by: null,
    rejection_reason: null,
    has_proof: true,
  },
  reservation: {
    id: 'res-1',
    booker_name: 'Ana Pérez',
    booker_phone: '04141234567',
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
  passengers: [
    {
      id: 'pass-1',
      seat_code: 'A1',
      name: 'Ana Pérez',
      unit_price: 25000,
      status: 'active',
    },
  ],
  allocations: [],
  totals: {
    active_passenger_count: 1,
    expected_cents: 25000,
    allocated_cents: 0,
    remaining_cents: 25000,
  },
};

function findCall(table: string): RtCall {
  // Solo los canales vivos: el detalle de pago re-suscribe una vez que
  // aparece reservation_id (los anteriores ya recibieron cleanup).
  const call = [...rt.calls]
    .reverse()
    .find((c) => c.table === table && !c.removed);
  if (!call) throw new Error(`no hay canal activo de ${table}`);
  return call;
}

beforeEach(() => {
  vi.clearAllMocks();
  rt.reset();
  params.id = 'attempt-1';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RT-06 · listado /agency/payments', () => {
  it('suscribe checkout_attempts y payments filtrando por la agencia', async () => {
    mockListCheckoutAttempts.mockResolvedValue({
      attempts: [ATTEMPT_ITEM],
      page: 1,
      limit: 20,
      total: 1,
    });

    render(<AgencyPaymentsPage />);
    expect(await screen.findByText('Caracas → Maracaibo', W)).toBeTruthy();

    expect(rt.calls.filter((c) => !c.removed)).toHaveLength(2);
    expect(findCall('checkout_attempts').options?.agencyId).toBe('agency-1');
    expect(findCall('payments').options?.agencyId).toBe('agency-1');
  });

  it('un evento re-consulta el listado tras el debounce (500 ms)', async () => {
    mockListCheckoutAttempts.mockResolvedValue({
      attempts: [ATTEMPT_ITEM],
      page: 1,
      limit: 20,
      total: 1,
    });

    render(<AgencyPaymentsPage />);
    expect(await screen.findByText('Caracas → Maracaibo', W)).toBeTruthy();
    expect(mockListCheckoutAttempts).toHaveBeenCalledTimes(1);

    act(() => findCall('checkout_attempts').onChange());

    // Antes del debounce no re-consulta.
    await sleep(300);
    expect(mockListCheckoutAttempts).toHaveBeenCalledTimes(1);

    await waitFor(
      () => expect(mockListCheckoutAttempts).toHaveBeenCalledTimes(2),
      W,
    );
    expect(mockListCheckoutAttempts).toHaveBeenLastCalledWith({
      status: undefined,
      page: 1,
      limit: 20,
    });
  });

  it('una ráfaga de eventos produce UNA sola re-consulta', async () => {
    mockListCheckoutAttempts.mockResolvedValue({
      attempts: [ATTEMPT_ITEM],
      page: 1,
      limit: 20,
      total: 1,
    });

    render(<AgencyPaymentsPage />);
    expect(await screen.findByText('Caracas → Maracaibo', W)).toBeTruthy();

    act(() => {
      findCall('checkout_attempts').onChange();
      findCall('checkout_attempts').onChange();
      findCall('payments').onChange();
    });

    await waitFor(
      () => expect(mockListCheckoutAttempts).toHaveBeenCalledTimes(2),
      W,
    );
    // Pasa el debounce + min-gap: no debe haber una tercera consulta.
    await sleep(900);
    expect(mockListCheckoutAttempts).toHaveBeenCalledTimes(2);
  });

  it('al desmontar limpia los canales y cancela el refresco pendiente', async () => {
    mockListCheckoutAttempts.mockResolvedValue({
      attempts: [ATTEMPT_ITEM],
      page: 1,
      limit: 20,
      total: 1,
    });

    const { unmount } = render(<AgencyPaymentsPage />);
    expect(await screen.findByText('Caracas → Maracaibo', W)).toBeTruthy();

    const call = findCall('checkout_attempts');
    act(() => call.onChange());
    unmount();

    expect(rt.calls.every((c) => c.removed)).toBe(true);

    // El timer cancelado no debe disparar consultas fuera de pantalla.
    await sleep(900);
    expect(mockListCheckoutAttempts).toHaveBeenCalledTimes(1);
  });

  it('degrada con banner al perder Realtime y "Actualizar" reconsulta ya', async () => {
    mockListCheckoutAttempts.mockResolvedValue({
      attempts: [ATTEMPT_ITEM],
      page: 1,
      limit: 20,
      total: 1,
    });

    render(<AgencyPaymentsPage />);
    expect(await screen.findByText('Caracas → Maracaibo', W)).toBeTruthy();
    expect(
      screen.queryByText(/Sin actualizaciones en vivo/),
    ).toBeNull();

    const call = findCall('checkout_attempts');
    act(() => {
      (call.options?.onStatus as (ok: boolean) => void)(false);
    });

    expect(
      await screen.findByText(/Sin actualizaciones en vivo/, W),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(
      () => expect(mockListCheckoutAttempts).toHaveBeenCalledTimes(2),
      W,
    );

    act(() => {
      (call.options?.onStatus as (ok: boolean) => void)(true);
    });
    await waitFor(() => {
      expect(screen.queryByText(/Sin actualizaciones en vivo/)).toBeNull();
    }, W);
  });

  it('descarta la respuesta vieja si una carga posterior llegó primero', async () => {
    let resolveFirst!: (value: unknown) => void;
    mockListCheckoutAttempts.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );

    render(<AgencyPaymentsPage />);
    expect(rt.calls.length).toBeGreaterThan(0);

    mockListCheckoutAttempts.mockResolvedValue({
      attempts: [
        { ...ATTEMPT_ITEM, booker: { ...ATTEMPT_ITEM.booker, name: 'María Nueva' } },
      ],
      page: 1,
      limit: 20,
      total: 1,
    });

    act(() => findCall('checkout_attempts').onChange());
    expect(await screen.findByText('María Nueva', W)).toBeTruthy();

    // La primera carga (seq vieja) resuelve al final: no debe pisar.
    await act(async () => {
      resolveFirst({
        attempts: [
          { ...ATTEMPT_ITEM, booker: { ...ATTEMPT_ITEM.booker, name: 'Ana Pérez' } },
        ],
        page: 1,
        limit: 20,
        total: 1,
      });
      await Promise.resolve();
    });

    expect(screen.getByText('María Nueva')).toBeTruthy();
    expect(screen.queryByText('Ana Pérez')).toBeNull();
  });
});

describe('RT-06 · detalle de pago', () => {
  it('se suscribe al pago por id y un evento refresca el estado en pantalla', async () => {
    params.id = 'pay-1';
    mockGetPayment.mockResolvedValue(PAYMENT_DETAIL);

    render(<PaymentDetailPage />);
    expect(
      await screen.findByText(PAYMENT_STATUS_LABELS.pending, W),
    ).toBeTruthy();

    expect(rt.calls.filter((c) => !c.removed)).toHaveLength(1);
    expect(findCall('payments').options?.paymentId).toBe('pay-1');

    mockGetPayment.mockResolvedValue({
      ...PAYMENT_DETAIL,
      payment: {
        ...PAYMENT_DETAIL.payment,
        status: 'verified',
        verified_at: '2026-10-02T12:00:00Z',
      },
      reservation: { ...PAYMENT_DETAIL.reservation, payment_status: 'fully_paid' },
    });

    act(() => findCall('payments').onChange());

    // 'Verificado' aparece en el badge y en la fila "Verificado" (verified_at).
    expect(
      (await screen.findAllByText(PAYMENT_STATUS_LABELS.verified, W)).length,
    ).toBeGreaterThan(0);
  });
});

describe('RT-06 · detalle de compra (attempts)', () => {
  it('se suscribe al intento por id y un evento refresca el estado en pantalla', async () => {
    mockGetCheckoutAttempt.mockResolvedValue(ATTEMPT_DETAIL);

    render(<CheckoutAttemptDetailPage />);
    expect(
      await screen.findByText(CHECKOUT_ATTEMPT_STATUS_LABELS.pending_review, W),
    ).toBeTruthy();

    expect(rt.calls.filter((c) => !c.removed)).toHaveLength(1);
    expect(findCall('checkout_attempts').options?.attemptId).toBe('attempt-1');

    mockGetCheckoutAttempt.mockResolvedValue({
      ...ATTEMPT_DETAIL,
      attempt: {
        ...ATTEMPT_DETAIL.attempt,
        status: 'verified',
        verified_at: '2026-10-02T12:00:00Z',
        reservation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    });

    act(() => findCall('checkout_attempts').onChange());

    // 'Verificada' aparece en el badge y en la fila "Verificada" (verified_at).
    expect(
      (
        await screen.findAllByText(CHECKOUT_ATTEMPT_STATUS_LABELS.verified, W)
      ).length,
    ).toBeGreaterThan(0);
    // Tras verificar aparece el enlace a la reserva (nueva fila de detalle).
    expect(await screen.findByText('Ver reserva', W)).toBeTruthy();
  });
});
