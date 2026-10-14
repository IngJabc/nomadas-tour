import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { agencyApi } from '@/lib/api';

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
    expect(url).toBe('http://localhost:3001/api/agency/payments?status=pending&page=2&limit=20');
  });

  it('listPayments omite page/limit undefined y status vacío', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payments: [], page: 1, limit: 20, total: 0 }));

    await agencyApi.listPayments();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/agency/payments');
  });

  it('getPayment llama GET /agency/payments/:id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payment: { id: 'p1' } }));

    await agencyApi.getPayment('p1');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/agency/payments/p1');
  });

  it('getPaymentProof llama GET /agency/payments/:id/proof', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ url: 'https://signed.example/x', expires_in_seconds: 300 }),
    );

    await agencyApi.getPaymentProof('p1');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/agency/payments/p1/proof');
  });

  it('verifyPayment hace POST sin body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payment_id: 'p1', status: 'verified' }));

    await agencyApi.verifyPayment('p1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/agency/payments/p1/verify');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('rejectPayment hace POST con reason', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payment_id: 'p1', status: 'rejected' }));

    await agencyApi.rejectPayment('p1', 'Comprobante inválido');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/agency/payments/p1/reject');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ reason: 'Comprobante inválido' });
  });

  it('expone los tipos de estado del catálogo', async () => {
    const { PAYMENT_STATUS_LABELS, paymentStatusBadgeVariant } = await import('@/lib/payments');
    expect(PAYMENT_STATUS_LABELS.pending).toBe('Pendiente');
    expect(paymentStatusBadgeVariant('pending')).toBe('warning');
    expect(paymentStatusBadgeVariant('verified')).toBe('active');
    expect(paymentStatusBadgeVariant('rejected')).toBe('cancelled');
  });
});
