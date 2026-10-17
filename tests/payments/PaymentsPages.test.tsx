import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
} = vi.hoisted(() => ({
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
}));

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
