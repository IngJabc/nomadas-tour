import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  mockListPaymentMethods,
  mockCreatePaymentMethod,
  mockUpdatePaymentMethod,
  mockSetPrimary,
  mockDeletePaymentMethod,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockListPaymentMethods: vi.fn(),
  mockCreatePaymentMethod: vi.fn(),
  mockUpdatePaymentMethod: vi.fn(),
  mockSetPrimary: vi.fn(),
  mockDeletePaymentMethod: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  agencyApi: {
    listPaymentMethods: () => mockListPaymentMethods(),
    createPaymentMethod: (data: unknown) => mockCreatePaymentMethod(data),
    updatePaymentMethod: (id: string, patch: unknown) =>
      mockUpdatePaymentMethod(id, patch),
    setPaymentMethodPrimary: (id: string) => mockSetPrimary(id),
    deletePaymentMethod: (id: string) => mockDeletePaymentMethod(id),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import AgencyPaymentMethodsSettingsPage from '@/app/agency/settings/payment-methods/page';
import { ApiError } from '@/lib/errors/api-error';

const METHOD_ID = '99999999-9999-4999-8999-999999999999';

function methodFixture(partial: Record<string, unknown> = {}) {
  return {
    id: METHOD_ID,
    agency_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
    is_active: true,
    is_primary: true,
    sort_order: 0,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    deleted_at: null,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListPaymentMethods.mockResolvedValue({ methods: [methodFixture()] });
});

describe('AgencyPaymentMethodsSettingsPage (MKT-007.4)', () => {
  it('lista los métodos de pago existentes con su detalle', async () => {
    render(<AgencyPaymentMethodsSettingsPage />);

    expect(
      await screen.findByText('Pago Móvil Banesco'),
    ).toBeTruthy();
    expect(screen.getByText(/Banesco \(0134\)/)).toBeTruthy();
    expect(screen.getByText(/Teléfono 04121234567/)).toBeTruthy();
    expect(mockListPaymentMethods).toHaveBeenCalledTimes(1);
  });

  it('muestra el aviso de Sin métodos activos con el copy de WhatsApp', async () => {
    mockListPaymentMethods.mockResolvedValue({
      methods: [methodFixture({ is_active: false, is_primary: false })],
    });

    render(<AgencyPaymentMethodsSettingsPage />);

    expect(
      await screen.findByText(
        'Sin métodos activos no se pueden iniciar compras',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/el envío de un comprobante por WhatsApp no confirma la reserva/),
    ).toBeTruthy();
  });

  it('muestra empty state con CTA cuando no hay métodos de pago', async () => {
    mockListPaymentMethods.mockResolvedValue({ methods: [] });

    render(<AgencyPaymentMethodsSettingsPage />);

    expect(
      await screen.findByText(/Todavía no tienes métodos de pago/),
    ).toBeTruthy();
    const ctas = screen.getAllByRole('button', {
      name: /Agregar método de pago/,
    });
    expect(ctas.length).toBeGreaterThan(0);
  });

  it('muestra error de carga con botón de reintentar', async () => {
    mockListPaymentMethods.mockRejectedValue(new Error('boom'));

    render(<AgencyPaymentMethodsSettingsPage />);

    expect(
      await screen.findByText(
        'No se pudieron cargar los métodos de pago. Intenta de nuevo.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reintentar' }),
    ).toBeTruthy();
  });

  it('el borrado siempre pasa por el modal de confirmación', async () => {
    render(<AgencyPaymentMethodsSettingsPage />);
    await screen.findByText('Pago Móvil Banesco');

    fireEvent.click(screen.getByRole('button', { name: /Eliminar/ }));

    // Sin confirmar todavía: la API no se toca.
    expect(mockDeletePaymentMethod).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(
      screen.getByText(/dejará de mostrarse en el marketplace/),
    ).toBeTruthy();

    mockDeletePaymentMethod.mockResolvedValue({
      payment_method: methodFixture({ deleted_at: '2026-10-02T00:00:00.000Z' }),
      already_deleted: false,
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Eliminar método' }),
    );

    await waitFor(() => {
      expect(mockDeletePaymentMethod).toHaveBeenCalledWith(METHOD_ID);
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Método de pago eliminado');
  });

  it('crear valida el formulario antes de llamar a la API', async () => {
    render(<AgencyPaymentMethodsSettingsPage />);
    await screen.findByText('Pago Móvil Banesco');

    fireEvent.click(
      screen.getAllByRole('button', { name: /Agregar método de pago/ })[0],
    );
    // Enviar con el formulario vacío: solo validación local.
    fireEvent.click(screen.getByRole('button', { name: 'Crear método' }));

    expect(mockCreatePaymentMethod).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      'Revisa los datos del método de pago',
    );
    expect(
      screen.getByText('El código del banco debe tener 4 dígitos.'),
    ).toBeTruthy();
  });

  it('crea un método de pago válido y recarga la lista', async () => {
    mockCreatePaymentMethod.mockResolvedValue({
      payment_method: methodFixture(),
    });

    render(<AgencyPaymentMethodsSettingsPage />);
    await screen.findByText('Pago Móvil Banesco');

    fireEvent.click(
      screen.getAllByRole('button', { name: /Agregar método de pago/ })[0],
    );

    fireEvent.change(screen.getByLabelText('Nombre del método'), {
      target: { value: 'Pago Móvil Mercantil' },
    });
    fireEvent.change(screen.getByLabelText('Código del banco'), {
      target: { value: '0105' },
    });
    fireEvent.change(screen.getByLabelText('Banco'), {
      target: { value: 'Mercantil' },
    });
    fireEvent.change(screen.getByLabelText('Teléfono (cuenta)'), {
      target: { value: '04141234567' },
    });
    fireEvent.change(screen.getByLabelText('Tipo de documento'), {
      target: { value: 'V' },
    });
    fireEvent.change(screen.getByLabelText('Número de documento'), {
      target: { value: '87654321' },
    });
    fireEvent.change(screen.getByLabelText('Titular de la cuenta'), {
      target: { value: 'Agencia Central' },
    });

    mockListPaymentMethods.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Crear método' }));

    await waitFor(() => {
      expect(mockCreatePaymentMethod).toHaveBeenCalledWith({
        method: 'pago_movil',
        label: 'Pago Móvil Mercantil',
        data: expect.objectContaining({
          bank_code: '0105',
          bank_name: 'Mercantil',
          phone: '04141234567',
          document_type: 'V',
          document_number: '87654321',
          holder_name: 'Agencia Central',
        }),
        is_primary: false,
      });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Método de pago creado');
    await waitFor(() => {
      expect(mockListPaymentMethods).toHaveBeenCalled();
    });
  });

  it('muestra el conflicto AGENCY_HAS_ACTIVE_CHECKOUTS del backend como toast', async () => {
    mockListPaymentMethods.mockResolvedValue({
      methods: [methodFixture({ is_primary: false })],
    });
    mockSetPrimary.mockRejectedValue(
      new ApiError(
        'No se pueden modificar los métodos de pago mientras existan compras activas de la agencia.',
        409,
        'AGENCY_HAS_ACTIVE_CHECKOUTS',
      ),
    );

    render(<AgencyPaymentMethodsSettingsPage />);
    await screen.findByText('Pago Móvil Banesco');

    fireEvent.click(screen.getByRole('button', { name: /Hacer principal/ }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining('compras activas'),
      );
    });
  });

  it('al fallar la carga no ofrece Crear métodoes', async () => {
    mockListPaymentMethods.mockRejectedValue(new Error('boom'));

    render(<AgencyPaymentMethodsSettingsPage />);
    await screen.findByText(
      'No se pudieron cargar los métodos de pago. Intenta de nuevo.',
    );

    // El CTA principal queda deshabilitado sin datos confiables.
    expect(
      screen.getByRole('button', { name: /Agregar método de pago/ }),
    ).toHaveProperty('disabled', true);
  });

  it('el foco no salta al Nombre del método al escribir en otros campos', async () => {
    render(<AgencyPaymentMethodsSettingsPage />);
    await screen.findByText('Pago Móvil Banesco');

    fireEvent.click(
      screen.getAllByRole('button', { name: /Agregar método de pago/ })[0],
    );

    // El usuario escribe en un campo que NO es el primero del formulario.
    const bankCode = screen.getByLabelText('Código del banco');
    bankCode.focus();
    expect(document.activeElement).toBe(bankCode);

    // Cada keystroke re-renderiza la página (estado del form). El Modal no
    // debe reclamar el foco en ese re-render: antes del fix el effect se
    // re-ejecutaba y robaba el foco al primer input («Nombre del método»).
    fireEvent.change(bankCode, { target: { value: '01' } });
    expect(document.activeElement).toBe(bankCode);

    fireEvent.change(bankCode, { target: { value: '0105' } });
    expect(document.activeElement).toBe(bankCode);

    // Un segundo campo distinto conserva su foco igualmente.
    const phone = screen.getByLabelText('Teléfono (cuenta)');
    phone.focus();
    fireEvent.change(phone, { target: { value: '0414' } });
    expect(document.activeElement).toBe(phone);
    expect(screen.getByLabelText('Nombre del método')).not.toBe(
      document.activeElement,
    );
  });
});
