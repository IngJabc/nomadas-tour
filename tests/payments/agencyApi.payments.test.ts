import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { agencyApi } from '@/lib/api';

/**
 * Misma fuente de verdad que usa lib/api.ts para construir la base URL.
 * El host real depende de NEXT_PUBLIC_API_URL (p. ej. localhost o
 * 127.0.0.1 en CI); el test no debe acoplarse a un host concreto.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('agencyApi — Fase 2 pagos', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listPayments llama GET /agency/payments con filtros', async () => {
    const payload = { payments: [], page: 2, limit: 20, total: 0 };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const result = await agencyApi.listPayments({
      status: 'pending',
      page: 2,
      limit: 20,
    });

    expect(result).toEqual(payload);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/agency/payments?status=pending&page=2&limit=20`);
  });

  it('listPayments omite page/limit undefined y status vacío', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payments: [], page: 1, limit: 20, total: 0 }));

    await agencyApi.listPayments();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/agency/payments`);
  });

  it('getPayment llama GET /agency/payments/:id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payment: { id: 'p1' } }));

    await agencyApi.getPayment('p1');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/agency/payments/p1`);
  });

  it('getPaymentProof llama GET /agency/payments/:id/proof', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ url: 'https://signed.example/x', expires_in_seconds: 300 }),
    );

    await agencyApi.getPaymentProof('p1');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/agency/payments/p1/proof`);
  });

  it('verifyPayment hace POST sin body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payment_id: 'p1', status: 'verified' }));

    await agencyApi.verifyPayment('p1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/agency/payments/p1/verify`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('rejectPayment hace POST con reason', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payment_id: 'p1', status: 'rejected' }));

    await agencyApi.rejectPayment('p1', 'Comprobante inválido');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/agency/payments/p1/reject`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ reason: 'Comprobante inválido' });
  });

  it('listPayments envía el filtro de etapa (MKT-010.1)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payments: [], page: 1, limit: 20, total: 0 }));

    await agencyApi.listPayments({ stage: 'deposit' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/agency/payments?stage=deposit`);
  });

  it('listPayments omite la etapa vacía (sin filtrar)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payments: [], page: 1, limit: 20, total: 0 }));

    await agencyApi.listPayments({ stage: '' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/agency/payments`);
  });

  it('updateTripPaymentPlan hace PATCH con el body del plan', async () => {
    const payload = {
      trip_id: 't1',
      payment_plan: 'two_stage',
      deposit_amount_cents: 50000,
      deposit_deadline: '2026-11-20T23:59:59',
      balance_deadline: '2026-11-30T23:59:59',
      audit_id: 'a1',
    };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const result = await agencyApi.updateTripPaymentPlan('t1', {
      enabled: true,
      deposit_amount_cents: 50000,
      deposit_deadline: '2026-11-20',
      balance_deadline: '2026-11-30',
    });

    expect(result).toEqual(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/agency/trips/t1/payment-plan`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      enabled: true,
      deposit_amount_cents: 50000,
      deposit_deadline: '2026-11-20',
      balance_deadline: '2026-11-30',
    });
  });

  it('updateTripPaymentPlan deshabilita solo con enabled=false', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        trip_id: 't1',
        payment_plan: 'single',
        deposit_amount_cents: null,
        deposit_deadline: null,
        balance_deadline: null,
        audit_id: 'a2',
      }),
    );

    await agencyApi.updateTripPaymentPlan('t1', { enabled: false });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE}/agency/trips/t1/payment-plan`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ enabled: false });
  });

  it('expone los tipos de estado del catálogo', async () => {
    const { PAYMENT_STATUS_LABELS, PAYMENT_STATUS_PLURALS, paymentStatusBadgeVariant } =
      await import('@/lib/payments');
    expect(PAYMENT_STATUS_LABELS.pending).toBe('Pendiente');
    expect(PAYMENT_STATUS_LABELS.verified).toBe('Pago aprobado');
    expect(PAYMENT_STATUS_PLURALS.verified).toBe('aprobados');
    expect(paymentStatusBadgeVariant('pending')).toBe('warning');
    expect(paymentStatusBadgeVariant('verified')).toBe('active');
    expect(paymentStatusBadgeVariant('rejected')).toBe('cancelled');
  });

  it('expone los tipos de etapa del catálogo (MKT-010.1)', async () => {
    const {
      PAYMENT_STAGE_LABELS,
      PAYMENT_STAGE_FILTERS,
      PAYMENT_STAGE_NOUNS,
      paymentStageBadgeVariant,
    } = await import('@/lib/payments');
    expect(PAYMENT_STAGE_LABELS.full).toBe('Total');
    expect(PAYMENT_STAGE_LABELS.deposit).toBe('Primer pago');
    expect(PAYMENT_STAGE_LABELS.balance).toBe('Pago restante');
    expect(PAYMENT_STAGE_NOUNS.deposit).toBe('primer pago');
    expect(PAYMENT_STAGE_NOUNS.balance).toBe('pago restante');
    expect(paymentStageBadgeVariant('deposit')).toBe('info');
    expect(paymentStageBadgeVariant('balance')).toBe('warning');
    expect(paymentStageBadgeVariant('full')).toBe('inactive');
    // Chips de la vista Pagos (alcanzable con el toggle Solicitudes de
    // reserva/Pagos recibidos → aquí se cubren a nivel unitario; el flujo
    // está en PaymentsPages).
    expect(PAYMENT_STAGE_FILTERS.map((f) => f.label)).toEqual([
      'Todas',
      'Primer pago',
      'Pago restante',
      'Total',
    ]);
    expect(PAYMENT_STAGE_FILTERS.map((f) => f.value)).toEqual([
      '',
      'deposit',
      'balance',
      'full',
    ]);
  });
});
