import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * MKT-010.1 (lado Tour) — TripPaymentPlanModal.
 *
 * Cubre: cerrado no renderiza nada, revelado de los campos al habilitar,
 * precarga desde el viaje (importes en pesos COP y vencimientos `YYYY-MM-DD`),
 * PATCH con importe/cents + fechas, deshabilitar con `{ enabled: false }`,
 * validaciones en línea (sin importe, sin vencimientos, importe ≥ precio)
 * que NO llaman al backend, error del backend con `role="alert"` manteniendo
 * el modal abierto y lo escrito intacto, estado loading del botón y reset
 * del estado al reabrir con otro viaje. El backend sigue siendo la
 * autoridad: aquí solo se verifica el comportamiento de la UI.
 */

const { mockUpdateTripPaymentPlan, mockToastSuccess, mockToastError } =
  vi.hoisted(() => ({
    mockUpdateTripPaymentPlan: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockToastError: vi.fn(),
  }));

vi.mock('@/lib/api', () => ({
  agencyApi: {
    updateTripPaymentPlan: (tripId: string, data: unknown) =>
      mockUpdateTripPaymentPlan(tripId, data),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import { TripPaymentPlanModal } from '@/components/agency/TripPaymentPlanModal';
import type { AgencyTrip } from '@/components/agency/AgencyTripCard';

const BASE_TRIP: AgencyTrip = {
  id: 'trip-1',
  route: { origin: 'Caracas', destination: 'Maracaibo' },
  departure_time: '2026-12-01T07:00:00Z',
  vehicle_type: 'bus',
  status: 'active',
  total_seats: 31,
  available_seats: 20,
  reserved_seats: 11,
  seat_price: 25000, // $250,00
  installment_allowed: false,
  installment_amount_cents: null,
  deposit_deadline: null,
  balance_deadline: null,
  agency_count: 1,
};

const ENABLED_TRIP: AgencyTrip = {
  ...BASE_TRIP,
  installment_allowed: true,
  installment_amount_cents: 15000, // → input '150' (pesos COP) < $250,00
  deposit_deadline: '2026-12-10T23:59:59',
  balance_deadline: '2026-12-20T23:59:59',
};

function renderModal(
  overrides: Partial<{
    open: boolean;
    trip: AgencyTrip | null;
    onClose: () => void;
    onSuccess: () => void;
  }> = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  const onSuccess = overrides.onSuccess ?? vi.fn();
  const view = render(
    <TripPaymentPlanModal
      open={overrides.open ?? true}
      trip={overrides.trip ?? BASE_TRIP}
      onClose={onClose}
      onSuccess={onSuccess}
    />,
  );
  return { ...view, onClose, onSuccess };
}

async function openDialog() {
  return screen.findByRole('dialog', { name: 'Plan de pago' });
}

function checkbox(): HTMLInputElement {
  return screen.getByRole('checkbox') as HTMLInputElement;
}

function depositInput(): HTMLInputElement {
  return screen.getByLabelText('Primer pago por puesto (COP)') as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Guardar plan|Deshabilitar plan/ }) as HTMLButtonElement;
}

describe('TripPaymentPlanModal — MKT-010.1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cerrado no renderiza diálogo ni campos', () => {
    renderModal({ open: false });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('al habilitar revela importe, vencimientos y el aviso informativo', async () => {
    renderModal();

    await openDialog();
    expect(checkbox().checked).toBe(false);
    expect(screen.queryByLabelText('Primer pago por puesto (COP)')).toBeNull();

    fireEvent.click(checkbox());

    expect(depositInput()).toBeTruthy();
    expect(depositInput().placeholder).toBe('Ej: 50000');
    expect(screen.getByText('Fecha límite del primer pago')).toBeTruthy();
    expect(screen.getByText('Fecha límite del pago restante')).toBeTruthy();
    expect(
      screen.getByText(
        'Cobra primero el primer pago fijo por puesto y después el pago restante.',
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: 'Elige una fecha' }),
    ).toHaveLength(2);
    expect(screen.getByText(/Debe ser menor que el precio por puesto \(\$250,00\)/)).toBeTruthy();
    expect(
      screen.getByText(
        /Las fechas límite son informativas: no cancelan la reserva\s+ni liberan los asientos/,
      ),
    ).toBeTruthy();
  });

  it('precarga importe y vencimientos del viaje y guarda con PATCH completo', async () => {
    mockUpdateTripPaymentPlan.mockResolvedValue({} as never);
    const { onSuccess } = renderModal({ trip: ENABLED_TRIP });

    await openDialog();
    expect(checkbox().checked).toBe(true);
    expect(depositInput().value).toBe('150');
    expect(saveButton().textContent).toContain('Guardar plan');

    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(mockUpdateTripPaymentPlan).toHaveBeenCalledWith('trip-1', {
        enabled: true,
        deposit_amount_cents: 15000,
        deposit_deadline: '2026-12-10',
        balance_deadline: '2026-12-20',
      });
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Plan de pago habilitado correctamente',
      );
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('deshabilitar envía solo { enabled: false }', async () => {
    mockUpdateTripPaymentPlan.mockResolvedValue({} as never);
    const { onSuccess } = renderModal({ trip: ENABLED_TRIP });

    await openDialog();
    fireEvent.click(checkbox()); // apaga el plan

    expect(screen.queryByLabelText('Primer pago por puesto (COP)')).toBeNull();
    expect(saveButton().textContent).toContain('Deshabilitar plan');

    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(mockUpdateTripPaymentPlan).toHaveBeenCalledWith('trip-1', {
        enabled: false,
      });
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Plan de pago deshabilitado correctamente',
      );
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('habilitar sin importe bloquea el guardado con mensaje en línea', async () => {
    const { onSuccess } = renderModal();

    await openDialog();
    fireEvent.click(checkbox());
    fireEvent.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'El primer pago por puesto es obligatorio para habilitar el plan.',
    );
    expect(mockUpdateTripPaymentPlan).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('habilitar sin vencimientos bloquea el guardado con mensaje en línea', async () => {
    const { onSuccess } = renderModal();

    await openDialog();
    fireEvent.click(checkbox());
    fireEvent.change(depositInput(), { target: { value: '200' } });
    fireEvent.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Las fechas límite del primer pago y del pago restante son obligatorias.',
    );
    expect(mockUpdateTripPaymentPlan).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('un primer pago igual al precio del puesto bloquea el guardado', async () => {
    // Viaje con plan ya habilitado: los vencimientos vienen precargados,
    // así que la validación de precio es la única que puede dispararse.
    const { onSuccess } = renderModal({ trip: ENABLED_TRIP });

    await openDialog();
    fireEvent.change(depositInput(), { target: { value: '250' } }); // == $250,00
    fireEvent.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'El primer pago debe ser menor que el precio por puesto.',
    );
    expect(mockUpdateTripPaymentPlan).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    // Nada de lo escrito se pierde.
    expect(depositInput().value).toBe('250');
  });

  it('error del backend deja el modal abierto con role="alert" y sin éxito falso', async () => {
    mockUpdateTripPaymentPlan.mockRejectedValue(
      new Error(
        'ERR_PAYMENT_PLAN_DEADLINES: El vencimiento del saldo debe estar en el futuro',
      ),
    );
    const { onSuccess } = renderModal({ trip: ENABLED_TRIP });

    await openDialog();
    fireEvent.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'ERR_PAYMENT_PLAN_DEADLINES: El vencimiento del saldo debe estar en el futuro',
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    // El modal sigue abierto y lo escrito sigue intacto.
    expect(screen.getByRole('dialog', { name: 'Plan de pago' })).toBeTruthy();
    expect(depositInput().value).toBe('150');
  });

  it('el botón queda deshabilitado mientras guarda (estado loading)', async () => {
    let resolveSave: (() => void) | null = null;
    mockUpdateTripPaymentPlan.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { onSuccess } = renderModal({ trip: ENABLED_TRIP });

    await openDialog();
    fireEvent.click(saveButton());

    expect(saveButton().disabled).toBe(true);

    resolveSave!();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it('Cancelar llama a onClose sin enviar nada', async () => {
    const { onClose } = renderModal();

    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockUpdateTripPaymentPlan).not.toHaveBeenCalled();
  });

  it('reabrir con otro viaje resetea el estado (sin arrastrar valores)', async () => {
    const { rerender } = renderModal({ trip: ENABLED_TRIP });

    await openDialog();
    expect(checkbox().checked).toBe(true);
    expect(depositInput().value).toBe('150');

    rerender(
      <TripPaymentPlanModal
        open={false}
        trip={ENABLED_TRIP}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    rerender(
      <TripPaymentPlanModal
        open
        trip={BASE_TRIP}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await openDialog();
    expect(checkbox().checked).toBe(false);
    expect(screen.queryByLabelText('Primer pago por puesto (COP)')).toBeNull();
    expect(saveButton().textContent).toContain('Deshabilitar plan');
  });
});
