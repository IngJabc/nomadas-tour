import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VehicleStep } from '@/components/admin/trip-builder/VehicleStep';
import { formatSeatPriceCents } from '@/lib/price';

function renderStep(overrides: Partial<Parameters<typeof VehicleStep>[0]> = {}) {
  const onSelect = vi.fn();
  const onSeatPriceInputChange = vi.fn();
  const props = {
    selectedType: 'bus' as const,
    onSelect,
    seatPriceInput: '',
    onSeatPriceInputChange,
    ...overrides,
  };
  render(<VehicleStep {...props} />);
  return { onSelect, onSeatPriceInputChange, props };
}

function priceInput(): HTMLInputElement {
  return screen.getByLabelText('Precio por puesto (COP)') as HTMLInputElement;
}

describe('TRIP-PRICE-001 — VehicleStep precio por puesto', () => {
  it('renders a visible label (not placeholder-only)', () => {
    renderStep();
    expect(screen.getByText('Precio por puesto (COP)')).toBeTruthy();
  });

  it('renders the input bound to seatPriceInput', () => {
    renderStep({ seatPriceInput: '250000' });
    expect(priceInput().value).toBe('250000');
  });

  it('emits raw input changes for the reducer to store', () => {
    const { onSeatPriceInputChange } = renderStep();
    fireEvent.change(priceInput(), { target: { value: '1500' } });
    expect(onSeatPriceInputChange).toHaveBeenCalledWith('1500');
  });

  it('shows the COP preview when the value is a valid whole-peso price', () => {
    renderStep({ seatPriceInput: '250000' });
    const expected = formatSeatPriceCents(25_000_000);
    const preview = screen.getByText(/Se publicará como/);
    expect(preview.textContent).toContain(expected);
  });

  it('shows an inline error for fractional input', () => {
    renderStep({ seatPriceInput: '12.5' });
    expect(
      screen.getByText('Ingresa un precio entero en pesos COP, sin decimales ni puntos.'),
    ).toBeTruthy();
    expect(priceInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('shows helper text (conversion to cents) when empty', () => {
    renderStep();
    expect(screen.getByText(/Se guarda en centavos/)).toBeTruthy();
  });
});
