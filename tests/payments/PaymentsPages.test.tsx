import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import toast from 'react-hot-toast';

const {
  mockListPayments,
  mockGetPayment,
  mockGetPaymentProof,
  mockVerifyPayment,
  mockRejectPayment,
  mockListCheckoutAttempts,
  mockGetCheckoutAttempt,
  mockGetCheckoutAttemptProof,
  mockVerifyCheckoutAttempt,
  mockRejectCheckoutAttempt,
  mockUseParamsId,
  rt,
} = vi.hoisted(() => {
  type RtCall = {
    table: string;
    onChange: () => void;
    options: Record<string, unknown> | undefined;
    removed: boolean;
  };
  const rt: { calls: RtCall[]; reset: () => void } = {
    calls: [],
    reset: () => {
      rt.calls = [];
    },
  };
  return {
    mockListPayments: vi.fn(),
    mockGetPayment: vi.fn(),
    mockGetPaymentProof: vi.fn(),
    mockVerifyPayment: vi.fn(),
    mockRejectPayment: vi.fn(),
    mockListCheckoutAttempts: vi.fn(),
    mockGetCheckoutAttempt: vi.fn(),
    mockGetCheckoutAttemptProof: vi.fn(),
    mockVerifyCheckoutAttempt: vi.fn(),
    mockRejectCheckoutAttempt: vi.fn(),
    mockUseParamsId: vi.fn(() => 'pay-1'),
    rt,
  };
});

vi.mock('@/lib/api', () => ({
  agencyApi: {
    listPayments: (...args: unknown[]) => mockListPayments(...args),
    getPayment: (...args: unknown[]) => mockGetPayment(...args),
    getPaymentProof: (...args: unknown[]) => mockGetPaymentProof(...args),
    verifyPayment: (...args: unknown[]) => mockVerifyPayment(...args),
    rejectPayment: (...args: unknown[]) => mockRejectPayment(...args),
    listCheckoutAttempts: (...args: unknown[]) => mockListCheckoutAttempts(...args),
    getCheckoutAttempt: (...args: unknown[]) => mockGetCheckoutAttempt(...args),
    getCheckoutAttemptProof: (...args: unknown[]) => mockGetCheckoutAttemptProof(...args),
    verifyCheckoutAttempt: (...args: unknown[]) => mockVerifyCheckoutAttempt(...args),
    rejectCheckoutAttempt: (...args: unknown[]) => mockRejectCheckoutAttempt(...args),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// RT-06: los canales Realtime se registran en `rt` para poder disparar
// eventos/estado de conexión desde los tests sin tocar supabase-js.
vi.mock('@/lib/realtime/subscriptions', () => {
  const track =
    (table: string) =>
    (onChange: () => void, options?: Record<string, unknown>) => {
      const call = { table, onChange, options, removed: false };
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
  useParams: () => ({ id: mockUseParamsId() }),
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

const LIST_ITEM = {
  id: 'pay-1',
  status: 'pending',
  amount_cents: 50000,
  currency: 'COP',
  submitted_at: '2026-10-01T12:00:00Z',
  verified_at: null,
  rejection_reason: null,
  has_proof: true,
  reservation: {
    id: 'res-1',
    booker_name: 'Ana Pérez',
    contact_email: 'ana@example.com',
    status: 'confirmed',
    payment_status: 'pending',
    trip: {
      id: 'trip-1',
      departure_time: '2026-10-15T07:00:00Z',
      origin: 'Caracas',
      destination: 'Maracaibo',
    },
  },
};

const DETAIL = {
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
    {
      id: 'pass-2',
      seat_code: 'A2',
      name: 'Luis Pérez',
      unit_price: 25000,
      status: 'active',
    },
  ],
  allocations: [
    {
      id: 'alloc-1',
      reservation_passenger_id: 'pass-1',
      seat_code: 'A1',
      amount_cents: 25000,
      created_at: '2026-10-01T12:00:00Z',
    },
  ],
  totals: {
    active_passenger_count: 2,
    expected_cents: 50000,
    allocated_cents: 25000,
    remaining_cents: 25000,
  },
};

// ─── MKT-007 fixtures ────────────────────────────────────────────────────────

const ATTEMPT_LIST_ITEM = {
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
  booker: {
    name: 'Ana Pérez',
    document: '12345678',
    phone: '04141234567',
  },
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
    {
      seat_id: 'seat-2',
      seat_code: 'A2',
      first_name: 'Luis',
      last_name: 'Pérez',
      name: 'Luis Pérez',
      document: '87654321',
      phone: '04241234567',
    },
  ],
  history: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  rt.reset();
});

describe('AgencyPaymentsPage (listado de compras)', () => {
  it('lista las compras del listado (vista por defecto)', async () => {
    mockListCheckoutAttempts.mockResolvedValue({
      attempts: [ATTEMPT_LIST_ITEM],
      page: 1,
      limit: 20,
      total: 1,
    });

    render(<AgencyPaymentsPage />);

    expect(await screen.findByText('Caracas → Maracaibo')).toBeTruthy();
    expect(screen.getAllByText('En revisión').length).toBeGreaterThan(0);
    expect(mockListCheckoutAttempts).toHaveBeenCalledWith({
      status: undefined,
      page: 1,
      limit: 20,
    });
  });

  it('filtra compras por estado pendiente y resetea la página', async () => {
    mockListCheckoutAttempts.mockResolvedValue({
      attempts: [ATTEMPT_LIST_ITEM],
      page: 1,
      limit: 20,
      total: 1,
    });

    render(<AgencyPaymentsPage />);
    await screen.findAllByText('En revisión');

    fireEvent.click(screen.getByRole('button', { name: 'En revisión' }));

    await waitFor(() => {
      expect(mockListCheckoutAttempts).toHaveBeenCalledWith({
        status: 'pending_review',
        page: 1,
        limit: 20,
      });
    });
  });

  it('muestra empty state y CTA cuando no hay compras', async () => {
    mockListCheckoutAttempts.mockResolvedValue({
      attempts: [],
      page: 1,
      limit: 20,
      total: 0,
    });

    render(<AgencyPaymentsPage />);

    expect(
      await screen.findByText('Aún no hay compras de marketplace'),
    ).toBeTruthy();
    // PageHeader y EmptyState pueden mostrar el mismo CTA
    expect(screen.getAllByRole('link', { name: 'Ver reservas' }).length).toBeGreaterThan(0);
  });

  it('muestra error con botón de reintentar si falla la carga', async () => {
    mockListCheckoutAttempts.mockRejectedValue(new Error('boom'));

    render(<AgencyPaymentsPage />);

    expect(
      await screen.findByText('No se pudieron cargar las compras. Intenta de nuevo.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });
});

// ─── MKT-010.1 — toggle Pagos/Compras: pagos por etapa visibles ──────────────

describe('AgencyPaymentsPage — MKT-010.1 vista Pagos (etapas)', () => {
  // Un pago por etapa, con reservador único para localizar su tarjeta.
  const DEPOSIT_CARD = {
    ...LIST_ITEM,
    id: 'pay-dep',
    stage: 'deposit',
    reservation: { ...LIST_ITEM.reservation, booker_name: 'Rosa Depósito' },
  };
  const BALANCE_CARD = {
    ...LIST_ITEM,
    id: 'pay-bal',
    stage: 'balance',
    reservation: { ...LIST_ITEM.reservation, booker_name: 'Mario Saldo' },
  };

  const paymentsResponse = (payments: unknown[]) => ({
    payments,
    page: 1,
    limit: 20,
    total: payments.length,
  });

  /** Deja la página renderizada en la vista por defecto (Compras). */
  const renderWithAttempts = () => {
    mockListCheckoutAttempts.mockResolvedValue({
      attempts: [ATTEMPT_LIST_ITEM],
      page: 1,
      limit: 20,
      total: 1,
    });
    render(<AgencyPaymentsPage />);
  };

  it('el toggle «Pagos» consulta listPayments y actualiza el título', async () => {
    renderWithAttempts();
    mockListPayments.mockResolvedValue(paymentsResponse([BALANCE_CARD]));
    await screen.findAllByText('En revisión');

    fireEvent.click(screen.getByRole('button', { name: 'Pagos' }));

    await waitFor(() => {
      expect(mockListPayments).toHaveBeenCalledWith({
        status: undefined,
        stage: undefined,
        page: 1,
        limit: 20,
      });
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pagos' }),
    ).toBeTruthy();
    expect(await screen.findByRole('link', { name: /Mario Saldo/ })).toBeTruthy();
  });

  it('etiqueta cada pago con su etapa: Depósito y Saldo en la tarjeta', async () => {
    mockListPayments.mockResolvedValue(
      paymentsResponse([DEPOSIT_CARD, BALANCE_CARD]),
    );
    renderWithAttempts();
    await screen.findAllByText('En revisión');

    fireEvent.click(screen.getByRole('button', { name: 'Pagos' }));

    const depositCard = await screen.findByRole('link', {
      name: /Rosa Depósito/,
    });
    expect(within(depositCard).getByText('Depósito')).toBeTruthy();

    const balanceCard = screen.getByRole('link', { name: /Mario Saldo/ });
    expect(within(balanceCard).getByText('Saldo')).toBeTruthy();
    // 'full' nunca muestra badge de etapa (estado por defecto).
    expect(
      within(balanceCard).queryByText('Total'),
    ).toBeNull();
  });

  it('el chip «Saldos» filtra listPayments por stage=balance', async () => {
    renderWithAttempts();
    mockListPayments.mockResolvedValue(paymentsResponse([BALANCE_CARD]));
    await screen.findAllByText('En revisión');

    fireEvent.click(screen.getByRole('button', { name: 'Pagos' }));
    await screen.findByRole('link', { name: /Mario Saldo/ });

    const stageGroup = screen.getByRole('group', {
      name: 'Filtrar por etapa del pago',
    });
    fireEvent.click(within(stageGroup).getByRole('button', { name: 'Saldos' }));

    await waitFor(() => {
      expect(mockListPayments).toHaveBeenCalledWith({
        status: undefined,
        stage: 'balance',
        page: 1,
        limit: 20,
      });
    });
  });
});

describe('PaymentDetailPage (detalle)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParamsId.mockReturnValue('pay-1');
  });

  it('renderiza resumen, pasajeros y acciones de pago pendiente', async () => {
    mockGetPayment.mockResolvedValue(DETAIL);

    render(<PaymentDetailPage />);

    expect(await screen.findByText('Verificar pago')).toBeTruthy();
    expect(screen.getByText('Rechazar pago')).toBeTruthy();
    expect(screen.getByText('Ver comprobante')).toBeTruthy();
    // booker_name + pasajero con el mismo nombre
    expect(screen.getAllByText('Ana Pérez').length).toBeGreaterThan(0);
    expect(screen.getByText('Luis Pérez')).toBeTruthy();
    expect(screen.getByText('Restante')).toBeTruthy();
  });

  it('abre el modal de verificación y llama verifyPayment', async () => {
    mockGetPayment.mockResolvedValue(DETAIL);
    mockVerifyPayment.mockResolvedValue({
      payment_id: 'pay-1',
      status: 'verified',
      already_verified: false,
    });

    render(<PaymentDetailPage />);
    // Dos botones con el mismo texto: el de la página y el del ConfirmModal
    const pageVerifyBtns = await screen.findAllByText('Verificar pago');
    fireEvent.click(pageVerifyBtns[0]);

    // ConfirmModal: botón de confirmación (segundo)
    const confirmBtns = await screen.findAllByRole('button', { name: 'Verificar pago' });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(mockVerifyPayment).toHaveBeenCalledWith('pay-1');
    });
  });

  it('exige motivo en el rechazo y llama rejectPayment', async () => {
    mockGetPayment.mockResolvedValue(DETAIL);
    mockRejectPayment.mockResolvedValue({
      payment_id: 'pay-1',
      status: 'rejected',
      already_rejected: false,
    });

    render(<PaymentDetailPage />);
    fireEvent.click(await screen.findByText('Rechazar pago'));

    // El modal de rechazo tiene un textarea con label
    const textarea = await screen.findByLabelText('Motivo del rechazo');
    const submit = screen.getByRole('button', { name: 'Rechazar' });

    // Sin motivo: no debe llamar al backend
    fireEvent.click(submit);
    expect(mockRejectPayment).not.toHaveBeenCalled();
    expect(await screen.findByText('El motivo del rechazo es obligatorio.')).toBeTruthy();

    fireEvent.change(textarea, { target: { value: 'Comprobante no corresponde' } });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockRejectPayment).toHaveBeenCalledWith(
        'pay-1',
        'Comprobante no corresponde',
      );
    });
  });

  it('no muestra acciones de verificación/rechazo si el pago no está pendiente', async () => {
    mockGetPayment.mockResolvedValue({
      ...DETAIL,
      payment: { ...DETAIL.payment, status: 'verified', verified_at: '2026-10-02T12:00:00Z' },
    });

    render(<PaymentDetailPage />);

    expect(await screen.findByText('Ver comprobante')).toBeTruthy();
    expect(screen.queryByText('Verificar pago')).toBeNull();
    expect(screen.queryByText('Rechazar pago')).toBeNull();
  });

  it('muestra error 404 cuando el pago no existe o es de otra agencia', async () => {
    const notFound = Object.assign(new Error('Pago no encontrado'), {
      status: 404,
      code: 'NOT_FOUND',
    });
    mockGetPayment.mockRejectedValue(notFound);

    render(<PaymentDetailPage />);

    expect(
      await screen.findByText('Este pago no existe o no pertenece a tu agencia.'),
    ).toBeTruthy();
  });
});

// ─── MKT-007 · Detalle de intento ───────────────────────────────────────────

describe('CheckoutAttemptDetailPage (detalle de compra)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParamsId.mockReturnValue('attempt-1');
  });

  it('renderiza resumen, conciliación y acciones de compra pendiente', async () => {
    mockGetCheckoutAttempt.mockResolvedValue(ATTEMPT_DETAIL);

    render(<CheckoutAttemptDetailPage />);

    expect(await screen.findByText('Verificar compra')).toBeTruthy();
    expect(screen.getByText('Rechazar compra')).toBeTruthy();
    expect(screen.getByText('Ver comprobante')).toBeTruthy();
    // Conciliación
    expect(screen.getByText('Referencia')).toBeTruthy();
    expect(screen.getByText('00123456789')).toBeTruthy();
    expect(screen.getByText('Banco de Venezuela')).toBeTruthy();
    // Pasajeros
    expect(screen.getAllByText('Ana Pérez').length).toBeGreaterThan(0);
    expect(screen.getByText('Luis Pérez')).toBeTruthy();
  });

  // ─── MKT-007.4 · Snapshot del canal elegido ──────────────────────────────

  describe('snapshot del canal de pago (MKT-007.4)', () => {
    const VALID_SNAPSHOT = {
      method: 'pago_movil',
      label: 'Pago Móvil Banesco',
      data: {
        bank_code: '0134',
        bank_name: 'Banesco',
        phone: '04121234567',
        document_type: 'V',
        document_number: '12345678',
        holder_name: 'Agencia Central',
      },
      snapshot_version: 1,
      selected_at: '2026-10-01T12:00:00Z',
    };

    function detailWithSnapshot(payment_method_snapshot: unknown) {
      return {
        ...ATTEMPT_DETAIL,
        attempt: { ...ATTEMPT_DETAIL.attempt, payment_method_snapshot },
      };
    }

    it('muestra el snapshot válido congelado al momento de elegir', async () => {
      mockGetCheckoutAttempt.mockResolvedValue(detailWithSnapshot(VALID_SNAPSHOT));

      render(<CheckoutAttemptDetailPage />);

      expect(await screen.findByText('Pago Móvil Banesco')).toBeTruthy();
      expect(
        screen.getByText('Banesco (0134) · Tel. 04121234567 · Venezolano 12345678'),
      ).toBeTruthy();
    });

    it('muestra «Sin método seleccionado» cuando el snapshot es null', async () => {
      mockGetCheckoutAttempt.mockResolvedValue(detailWithSnapshot(null));

      render(<CheckoutAttemptDetailPage />);

      expect(await screen.findByText('Sin método seleccionado')).toBeTruthy();
      expect(screen.queryByText('Datos de pago')).toBeNull();
    });

    it('muestra «No disponible» ante un objeto incompleto sin inventar datos', async () => {
      mockGetCheckoutAttempt.mockResolvedValue(
        detailWithSnapshot({ method: 'pago_movil' }),
      );

      render(<CheckoutAttemptDetailPage />);

      expect(await screen.findByText('No disponible')).toBeTruthy();
      expect(screen.queryByText('Sin método seleccionado')).toBeNull();
      expect(screen.queryByText('Datos de pago (al momento de elegir)')).toBeNull();
      expect(screen.queryByText(/undefined/)).toBeNull();
    });

    it('muestra «No disponible» ante data malformada (no-objeto)', async () => {
      mockGetCheckoutAttempt.mockResolvedValue(
        detailWithSnapshot({
          method: 'pago_movil',
          label: 'Canal',
          data: 'corrupto',
        }),
      );

      render(<CheckoutAttemptDetailPage />);

      expect(await screen.findByText('No disponible')).toBeTruthy();
      expect(screen.queryByText(/undefined/)).toBeNull();
    });

    it('ignora campos no-string del data en vez de renderizar undefined', async () => {
      mockGetCheckoutAttempt.mockResolvedValue(
        detailWithSnapshot({
          method: 'pago_movil',
          label: 'Canal Raro',
          data: { phone: 12345, bank_name: { nested: true } },
        }),
      );

      render(<CheckoutAttemptDetailPage />);

      expect(await screen.findByText('Canal Raro')).toBeTruthy();
      expect(screen.queryByText(/undefined/)).toBeNull();
    });
  });

  it('abre el modal de verificación y llama verifyCheckoutAttempt', async () => {
    mockGetCheckoutAttempt.mockResolvedValue(ATTEMPT_DETAIL);
    mockVerifyCheckoutAttempt.mockResolvedValue({
      attempt_id: 'attempt-1',
      status: 'verified',
      already_verified: false,
    });

    render(<CheckoutAttemptDetailPage />);
    const pageVerifyBtns = await screen.findAllByText('Verificar compra');
    fireEvent.click(pageVerifyBtns[0]);

    const confirmBtns = await screen.findAllByRole('button', { name: 'Verificar compra' });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(mockVerifyCheckoutAttempt).toHaveBeenCalledWith('attempt-1');
    });
  });

  it('exige motivo en el rechazo y llama rejectCheckoutAttempt', async () => {
    mockGetCheckoutAttempt.mockResolvedValue(ATTEMPT_DETAIL);
    mockRejectCheckoutAttempt.mockResolvedValue({
      attempt_id: 'attempt-1',
      status: 'rejected',
      already_rejected: false,
      final: false,
      proof_count: 1,
      remaining_submissions: 1,
      rejection_reason: 'Comprobante ilegible',
      freed_seats: 2,
      audit_id: null,
    });

    render(<CheckoutAttemptDetailPage />);
    fireEvent.click(await screen.findByText('Rechazar compra'));

    const textarea = await screen.findByLabelText('Motivo del rechazo');
    const submit = screen.getByRole('button', { name: 'Rechazar' });

    fireEvent.click(submit);
    expect(mockRejectCheckoutAttempt).not.toHaveBeenCalled();
    expect(await screen.findByText('El motivo del rechazo es obligatorio.')).toBeTruthy();

    fireEvent.change(textarea, { target: { value: 'Comprobante ilegible' } });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockRejectCheckoutAttempt).toHaveBeenCalledWith(
        'attempt-1',
        'Comprobante ilegible',
      );
    });
  });

  it('no muestra acciones si la compra no está pendiente', async () => {
    mockGetCheckoutAttempt.mockResolvedValue({
      ...ATTEMPT_DETAIL,
      attempt: {
        ...ATTEMPT_DETAIL.attempt,
        status: 'verified',
        verified_at: '2026-10-02T12:00:00Z',
      },
    });

    render(<CheckoutAttemptDetailPage />);

    expect(await screen.findByText('Ver comprobante')).toBeTruthy();
    expect(screen.queryByText('Verificar compra')).toBeNull();
    expect(screen.queryByText('Rechazar compra')).toBeNull();
  });

  it('muestra «Ver reserva» con destino correcto cuando la compra está verificada', async () => {
    const reservationId = '11111111-1111-4111-8111-111111111111';
    mockGetCheckoutAttempt.mockResolvedValue({
      ...ATTEMPT_DETAIL,
      attempt: {
        ...ATTEMPT_DETAIL.attempt,
        status: 'verified',
        verified_at: '2026-10-02T12:00:00Z',
        reservation_id: reservationId,
      },
    });

    render(<CheckoutAttemptDetailPage />);

    const link = await screen.findByRole('link', { name: /Ver reserva/ });
    expect(link.getAttribute('href')).toBe(`/agency/reservations/${reservationId}`);
    // El enlace antiguo «Ver pago creado» ya no existe
    expect(screen.queryByText('Ver pago creado')).toBeNull();
  });

  it('no muestra «Ver reserva» si la compra no tiene reserva asociada', async () => {
    mockGetCheckoutAttempt.mockResolvedValue({
      ...ATTEMPT_DETAIL,
      attempt: {
        ...ATTEMPT_DETAIL.attempt,
        status: 'verified',
        verified_at: '2026-10-02T12:00:00Z',
        reservation_id: null,
      },
    });

    render(<CheckoutAttemptDetailPage />);

    expect(await screen.findByText('Ver comprobante')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Ver reserva/ })).toBeNull();
    expect(screen.queryByText('Ver pago creado')).toBeNull();
  });

  it('muestra error 404 cuando la compra no existe', async () => {
    const notFound = Object.assign(new Error('No encontrado'), {
      status: 404,
      code: 'NOT_FOUND',
    });
    mockGetCheckoutAttempt.mockRejectedValue(notFound);

    render(<CheckoutAttemptDetailPage />);

    expect(
      await screen.findByText('Esta compra no existe o no pertenece a tu agencia.'),
    ).toBeTruthy();
  });
});

// ─── MKT-010.1 — plan de pago en dos partes (depósito + saldo) ────────────────

describe('PaymentDetailPage — MKT-010.1 progreso de dos partes', () => {
  const TWO_STAGE_PROGRESS = {
    reservation_id: 'res-1',
    reservation_status: 'confirmed',
    payment_status: 'deposit_paid',
    plan: 'two_stage',
    passenger_count: 2,
    total_cents: 50000,
    deposit_cents: 25000,
    deposit_verified_at: '2026-10-01T12:00:00Z',
    paid_cents: 25000,
    balance_cents: 25000,
    deposit_pct: 50,
    balance_pct: 50,
    deposit_deadline: '2026-11-20T23:59:59',
    balance_deadline: '2026-11-30T23:59:59',
    deposit_overdue: false,
    balance_overdue: true,
    seats_held: true,
    payments: [],
    agency: {
      id: 'agency-1',
      name: 'Agencia Central',
      whatsapp_phone: '04141234567',
    },
  };

  function detailWith(partial: Record<string, unknown>) {
    return { ...DETAIL, ...partial };
  }

  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParamsId.mockReturnValue('pay-1');
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('muestra montos, porcentajes y vencimientos cuando el plan es two_stage', async () => {
    mockGetPayment.mockResolvedValue(
      detailWith({
        payment: { ...DETAIL.payment, stage: 'deposit' },
        progress: TWO_STAGE_PROGRESS,
      }),
    );

    render(<PaymentDetailPage />);

    const heading = await screen.findByText('Progreso del pago');
    expect(heading).toBeTruthy();
    expect(screen.getByText('Asientos reservados')).toBeTruthy();
    // Tres bloques: depósito, pagado y saldo. «Depósito» aparece también
    // como badge de etapa del encabezado (2 en total).
    expect(screen.getAllByText('Depósito')).toHaveLength(2);
    expect(screen.getByText('Pagado')).toBeTruthy();
    expect(screen.getByText('Saldo')).toBeTruthy();
    // Montos acotados a la tarjeta de progreso: los tres bloques suman
    // $250,00 (depósito 25000, pagado 25000 y saldo 25000 del fixture).
    const progressCard = heading.parentElement!.parentElement!.parentElement!;
    const progress = within(progressCard);
    expect(progress.getAllByText('$250,00')).toHaveLength(3);
    expect(progress.getByText('de $500,00 · 2 pasajeros')).toBeTruthy();
    expect(progress.getByText('Pendiente por cobrar')).toBeTruthy();
    // Vencimientos en vivo + badge de vencido (solo informativo).
    expect(progress.getByText(/20\/11\/2026/)).toBeTruthy();
    expect(progress.getByText(/30\/11\/2026/)).toBeTruthy();
    expect(progress.getByText('Vencido')).toBeTruthy();
    expect(
      progress.getByText(/no cancelan la reserva\s+ni liberan los asientos/),
    ).toBeTruthy();
  });

  it('muestra el badge de etapa en el encabezado', async () => {
    mockGetPayment.mockResolvedValue(
      detailWith({
        payment: { ...DETAIL.payment, stage: 'deposit' },
        progress: TWO_STAGE_PROGRESS,
      }),
    );

    render(<PaymentDetailPage />);

    expect(await screen.findByText('Progreso del pago')).toBeTruthy();
    expect(screen.getAllByText('Depósito').length).toBeGreaterThan(0);
    expect(screen.getByText('Pendiente')).toBeTruthy();
  });

  it('oculta el badge de etapa cuando la etapa es total (full)', async () => {
    mockGetPayment.mockResolvedValue(
      detailWith({
        payment: { ...DETAIL.payment, stage: 'full' },
        progress: TWO_STAGE_PROGRESS,
      }),
    );

    render(<PaymentDetailPage />);

    expect(await screen.findByText('Progreso del pago')).toBeTruthy();
    // Solo el bloque «Depósito» del progreso; ningún badge extra.
    expect(screen.getAllByText('Depósito')).toHaveLength(1);
  });

  it('no muestra la tarjeta de progreso en plan single', async () => {
    mockGetPayment.mockResolvedValue(
      detailWith({
        progress: { ...TWO_STAGE_PROGRESS, plan: 'single' },
      }),
    );

    render(<PaymentDetailPage />);

    expect(await screen.findByText('Verificar pago')).toBeTruthy();
    expect(screen.queryByText('Progreso del pago')).toBeNull();
    expect(screen.queryByText('Solicitar saldo por WhatsApp')).toBeNull();
  });

  it('no muestra la tarjeta cuando el backend no trae progreso', async () => {
    mockGetPayment.mockResolvedValue(detailWith({ progress: null }));

    render(<PaymentDetailPage />);

    expect(await screen.findByText('Verificar pago')).toBeTruthy();
    expect(screen.queryByText('Progreso del pago')).toBeNull();
  });

  it('abre wa.me con el mensaje de saldo hacia el reservante', async () => {
    mockGetPayment.mockResolvedValue(
      detailWith({
        payment: { ...DETAIL.payment, stage: 'balance' },
        progress: TWO_STAGE_PROGRESS,
      }),
    );

    render(<PaymentDetailPage />);

    fireEvent.click(await screen.findByText('Solicitar saldo por WhatsApp'));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
    const [url, target, features] = openSpy.mock.calls[0];
    expect(target).toBe('_blank');
    expect(String(features)).toContain('noopener');
    expect(String(url).startsWith('https://wa.me/584141234567?text=')).toBeTruthy();

    const message = decodeURIComponent(String(url).split('?text=')[1]);
    expect(message).toContain('Hola Ana Pérez:');
    expect(message).toContain('los asientos A1, A2');
    expect(message).toContain('Caracas → Maracaibo');
    expect(message).toContain('con la agencia Agencia Central');
    expect(message).toContain('saldo pendiente de $250,00');
    expect(message).toContain('Fecha límite de pago: 30/11/2026.');
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('null');
  });

  it('sin teléfono del reservante muestra toast exacto y no abre ventanas', async () => {
    mockGetPayment.mockResolvedValue(
      detailWith({
        reservation: { ...DETAIL.reservation, booker_phone: null },
        payment: { ...DETAIL.payment, stage: 'balance' },
        progress: TWO_STAGE_PROGRESS,
      }),
    );

    render(<PaymentDetailPage />);

    fireEvent.click(await screen.findByText('Solicitar saldo por WhatsApp'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('No hay teléfono del reservante');
    });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('oculta el botón de saldo cuando el saldo ya está saldado', async () => {
    mockGetPayment.mockResolvedValue(
      detailWith({
        payment: { ...DETAIL.payment, stage: 'balance', status: 'verified' },
        progress: {
          ...TWO_STAGE_PROGRESS,
          balance_cents: 0,
          paid_cents: 50000,
          balance_pct: 0,
        },
      }),
    );

    render(<PaymentDetailPage />);

    expect(await screen.findByText('Progreso del pago')).toBeTruthy();
    expect(screen.getByText('Saldado')).toBeTruthy();
    expect(screen.queryByText('Solicitar saldo por WhatsApp')).toBeNull();
  });
});

// ─── MKT-010.1 — rechazo de un pago de SALDO ──────────────────────────────────

describe('PaymentRejectModal — MKT-010.1 etapa balance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParamsId.mockReturnValue('pay-1');
  });

  it('aclara que rechazar el saldo no cancela la reserva', async () => {
    mockGetPayment.mockResolvedValue({
      ...DETAIL,
      payment: { ...DETAIL.payment, stage: 'balance' },
      progress: null,
    });

    render(<PaymentDetailPage />);

    fireEvent.click(await screen.findByText('Rechazar pago'));

    expect(
      await screen.findByText(
        'Rechazar este pago de SALDO no cancela la reserva ni libera los asientos: queda el saldo por cobrar. Explica el motivo para dejar registro.',
      ),
    ).toBeTruthy();
  });

  it('conserva el texto clásico para pagos de monto total', async () => {
    mockGetPayment.mockResolvedValue(DETAIL);

    render(<PaymentDetailPage />);

    fireEvent.click(await screen.findByText('Rechazar pago'));

    expect(
      await screen.findByText(
        'El rechazo puede cancelar la reserva y liberar los asientos. Explica el motivo para dejar registro.',
      ),
    ).toBeTruthy();
  });
});

// ─── MKT-010.1 — badge de etapa en la lista ───────────────────────────────────

// Los chips de etapa («Todas / Depósito / Saldos / Total») viven en la vista
// Pagos de /agency/payments, alcanzable de nuevo con el toggle Pagos/Compras
// restaurado por MKT-010.1. Sus etiquetas se cubren además a nivel unitario
// en agencyApi.payments.test.ts sobre PAYMENT_STAGE_FILTERS; el flujo completo
// (toggle → listPayments → badges Depósito/Saldo → filtro stage) está en el
// describe «AgencyPaymentsPage — MKT-010.1 vista Pagos (etapas)».

// ─── MKT-007.1 — notificación WhatsApp tras rechazo ──────────────────────────

describe('CheckoutAttemptDetailPage — MKT-007.1 notificación WhatsApp', () => {
  const REJECT_SUCCESS = {
    attempt_id: 'attempt-1',
    status: 'rejected',
    already_rejected: false,
    final: false,
    proof_count: 1,
    remaining_submissions: 1,
    rejection_reason: 'Comprobante ilegible',
    freed_seats: 2,
    audit_id: null,
  };

  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  async function rejectFromPage(
    detail: unknown = ATTEMPT_DETAIL,
  ) {
    mockGetCheckoutAttempt.mockResolvedValue(detail);
    render(<CheckoutAttemptDetailPage />);
    fireEvent.click(await screen.findByText('Rechazar compra'));
    const textarea = await screen.findByLabelText('Motivo del rechazo');
    fireEvent.change(textarea, { target: { value: 'Comprobante ilegible' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    await waitFor(() => {
      expect(mockRejectCheckoutAttempt).toHaveBeenCalledWith(
        'attempt-1',
        'Comprobante ilegible',
      );
    });
  }

  it('tras rechazo exitoso con teléfono ofrece notificar por WhatsApp', async () => {
    mockRejectCheckoutAttempt.mockResolvedValue(REJECT_SUCCESS);
    await rejectFromPage();

    expect(
      await screen.findByText('¿Desea notificar al reservante por WhatsApp?'),
    ).toBeTruthy();
    expect(screen.getByText('Sí, contactar por WhatsApp')).toBeTruthy();
    expect(screen.getByText('No, continuar')).toBeTruthy();
    expect(openSpy).not.toHaveBeenCalled();
    expect(mockRejectCheckoutAttempt).toHaveBeenCalledTimes(1);
  });

  it('al confirmar abre wa.me con el mensaje completo', async () => {
    mockRejectCheckoutAttempt.mockResolvedValue(REJECT_SUCCESS);
    await rejectFromPage();
    fireEvent.click(await screen.findByText('Sí, contactar por WhatsApp'));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
    const [url, target, features] = openSpy.mock.calls[0];
    expect(target).toBe('_blank');
    expect(String(features)).toContain('noopener');
    expect(String(url).startsWith('https://wa.me/584141234567?text=')).toBeTruthy();
    const message = decodeURIComponent(String(url).split('?text=')[1]);
    expect(message).toContain('Hola Ana Pérez:');
    expect(message).toContain('los asientos A1, A2');
    expect(message).toContain('Caracas → Maracaibo');
    expect(message).toContain('Agencia Central');
    expect(message).toContain('Motivo: Comprobante ilegible');
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('null');
  });

  it('al cancelar no abre WhatsApp ni repite el rechazo', async () => {
    mockRejectCheckoutAttempt.mockResolvedValue(REJECT_SUCCESS);
    await rejectFromPage();
    fireEvent.click(await screen.findByText('No, continuar'));

    await waitFor(() => {
      expect(screen.queryByText('¿Desea notificar al reservante por WhatsApp?')).toBeNull();
    });
    expect(openSpy).not.toHaveBeenCalled();
    expect(mockRejectCheckoutAttempt).toHaveBeenCalledTimes(1);
  });

  it('sin teléfono muestra toast exacto y no ofrece el modal', async () => {
    await rejectFromPage({
      ...ATTEMPT_DETAIL,
      passengers: [{ ...ATTEMPT_DETAIL.passengers[0], phone: null }],
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('No hay teléfono del reservante');
    });
    expect(screen.queryByText('¿Desea notificar al reservante por WhatsApp?')).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('con teléfono no normalizable no genera enlace roto', async () => {
    await rejectFromPage({
      ...ATTEMPT_DETAIL,
      passengers: [{ ...ATTEMPT_DETAIL.passengers[0], phone: 'abc' }],
    });

    fireEvent.click(await screen.findByText('Sí, contactar por WhatsApp'));

    expect(openSpy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'No se pudo abrir WhatsApp con este número',
    );
    await waitFor(() => {
      expect(screen.queryByText('¿Desea notificar al reservante por WhatsApp?')).toBeNull();
    });
  });

  it('si el rechazo falla no se ofrece notificación', async () => {
    mockGetCheckoutAttempt.mockResolvedValue(ATTEMPT_DETAIL);
    mockRejectCheckoutAttempt.mockRejectedValue(new Error('boom'));

    render(<CheckoutAttemptDetailPage />);
    fireEvent.click(await screen.findByText('Rechazar compra'));
    fireEvent.change(await screen.findByLabelText('Motivo del rechazo'), {
      target: { value: 'Comprobante ilegible' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));

    await waitFor(() => {
      expect(mockRejectCheckoutAttempt).toHaveBeenCalled();
    });
    expect(screen.queryByText('¿Desea notificar al reservante por WhatsApp?')).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('con already_rejected también ofrece notificar', async () => {
    mockRejectCheckoutAttempt.mockResolvedValue({
      ...REJECT_SUCCESS,
      already_rejected: true,
    });
    await rejectFromPage();

    expect(
      await screen.findByText('¿Desea notificar al reservante por WhatsApp?'),
    ).toBeTruthy();
    expect(mockRejectCheckoutAttempt).toHaveBeenCalledTimes(1);
  });
});
