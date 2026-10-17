import { describe, expect, it } from 'vitest';
import {
  describePaymentMethodSnapshot,
  parseAgencyPaymentMethodSnapshot,
} from '@/lib/payments';

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
  is_primary: true,
  snapshot_version: 1,
  selected_at: '2026-10-01T12:00:00Z',
};

describe('parseAgencyPaymentMethodSnapshot (MKT-007.4)', () => {
  it('acepta un snapshot completo y devuelve los campos', () => {
    const parsed = parseAgencyPaymentMethodSnapshot(VALID_SNAPSHOT);
    expect(parsed).not.toBeNull();
    expect(parsed!.method).toBe('pago_movil');
    expect(parsed!.label).toBe('Pago Móvil Banesco');
    expect(parsed!.data.bank_name).toBe('Banesco');
    expect(parsed!.snapshot_version).toBe(1);
  });

  it('rechaza null, undefined, primitivos y arrays', () => {
    expect(parseAgencyPaymentMethodSnapshot(null)).toBeNull();
    expect(parseAgencyPaymentMethodSnapshot(undefined)).toBeNull();
    expect(parseAgencyPaymentMethodSnapshot('canal')).toBeNull();
    expect(parseAgencyPaymentMethodSnapshot(42)).toBeNull();
    expect(parseAgencyPaymentMethodSnapshot(['pago_movil'])).toBeNull();
  });

  it('rechaza un objeto incompleto sin method o con method vacío', () => {
    expect(parseAgencyPaymentMethodSnapshot({})).toBeNull();
    expect(parseAgencyPaymentMethodSnapshot({ label: 'Canal', data: {} })).toBeNull();
    expect(
      parseAgencyPaymentMethodSnapshot({ method: '  ', label: 'Canal', data: {} }),
    ).toBeNull();
  });

  it('rechaza un objeto con label ausente o no-string', () => {
    expect(
      parseAgencyPaymentMethodSnapshot({ method: 'pago_movil', data: {} }),
    ).toBeNull();
    expect(
      parseAgencyPaymentMethodSnapshot({ method: 'pago_movil', label: 7, data: {} }),
    ).toBeNull();
  });

  it('rechaza data que no sea un objeto (malformado)', () => {
    expect(
      parseAgencyPaymentMethodSnapshot({
        method: 'pago_movil',
        label: 'Canal',
        data: 'corrupto',
      }),
    ).toBeNull();
    expect(
      parseAgencyPaymentMethodSnapshot({
        method: 'pago_movil',
        label: 'Canal',
        data: ['a'],
      }),
    ).toBeNull();
    expect(
      parseAgencyPaymentMethodSnapshot({
        method: 'pago_movil',
        label: 'Canal',
        data: null,
      }),
    ).toBeNull();
  });

  it('normaliza campos opcionales malformados a undefined', () => {
    const parsed = parseAgencyPaymentMethodSnapshot({
      ...VALID_SNAPSHOT,
      is_primary: 'si',
      snapshot_version: 'uno',
      selected_at: 123,
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.is_primary).toBeUndefined();
    expect(parsed!.snapshot_version).toBeUndefined();
    expect(parsed!.selected_at).toBeUndefined();
  });
});

describe('describePaymentMethodSnapshot (MKT-007.4)', () => {
  it('describe un snapshot pago_movil completo', () => {
    const parsed = parseAgencyPaymentMethodSnapshot(VALID_SNAPSHOT)!;
    expect(describePaymentMethodSnapshot(parsed)).toBe(
      'Pago móvil · Banesco (0134) · Tel. 04121234567 · Agencia Central · Venezolano 12345678',
    );
  });

  it('con data vacía muestra solo el método', () => {
    const parsed = parseAgencyPaymentMethodSnapshot({
      method: 'pago_movil',
      label: 'Canal',
      data: {},
    })!;
    expect(describePaymentMethodSnapshot(parsed)).toBe('Pago móvil');
  });

  it('ignora valores no-string sin producir "undefined"', () => {
    const parsed = parseAgencyPaymentMethodSnapshot({
      method: 'pago_movil',
      label: 'Canal Raro',
      data: { phone: 12345, bank_name: { nested: true }, holder_name: '' },
    })!;
    const described = describePaymentMethodSnapshot(parsed);
    expect(described).toBe('Pago móvil');
    expect(described).not.toContain('undefined');
    expect(described).not.toContain('12345');
  });

  it('usa el method crudo cuando no hay etiqueta conocida', () => {
    const parsed = parseAgencyPaymentMethodSnapshot({
      method: 'transferencia',
      label: 'Canal',
      data: {},
    })!;
    expect(describePaymentMethodSnapshot(parsed)).toBe('transferencia');
  });
});
