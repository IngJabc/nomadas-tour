import { describe, expect, it } from 'vitest';
import {
  whatsappHref,
  buildCheckoutRejectWhatsAppMessage,
} from '@/lib/whatsapp';

describe('whatsappHref', () => {
  it('devuelve null para teléfono null, undefined o vacío', () => {
    expect(whatsappHref(null)).toBeNull();
    expect(whatsappHref(undefined)).toBeNull();
    expect(whatsappHref('')).toBeNull();
    expect(whatsappHref('   ')).toBeNull();
  });

  it('normaliza el formato nacional con 0 al prefijo 58', () => {
    expect(whatsappHref('04141234567')).toBe('https://wa.me/584141234567');
  });

  it('preserva el código de país en formato +E.164', () => {
    expect(whatsappHref('+584141234567')).toBe('https://wa.me/584141234567');
  });

  it('quita el prefijo internacional 00', () => {
    expect(whatsappHref('00584141234567')).toBe('https://wa.me/584141234567');
  });

  it('acepta números de otro país sin forzar el 58', () => {
    expect(whatsappHref('+14155552671')).toBe('https://wa.me/14155552671');
  });

  it('devuelve null para números no normalizables', () => {
    expect(whatsappHref('abc')).toBeNull();
    expect(whatsappHref('12345')).toBeNull();
    expect(whatsappHref('0000')).toBeNull();
  });
});

describe('buildCheckoutRejectWhatsAppMessage', () => {
  const base = {
    bookerName: 'Ana Pérez',
    seatCodes: ['A1', 'A2'],
    origin: 'Caracas',
    destination: 'Maracaibo',
    departureLabel: '15 oct 2026, 07:00',
    agencyName: 'Agencia Central',
    reason: 'Comprobante ilegible',
  };

  it('incluye todos los datos del rechazo', () => {
    const message = buildCheckoutRejectWhatsAppMessage(base);
    expect(message).toContain('Hola Ana Pérez:');
    expect(message).toContain('los asientos A1, A2');
    expect(message).toContain('Caracas → Maracaibo');
    expect(message).toContain('15 oct 2026, 07:00');
    expect(message).toContain('Agencia Central');
    expect(message).toContain('Motivo: Comprobante ilegible');
    expect(message).toContain('Equipo Nómadas Tour');
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('null');
  });

  it('usa fallbacks neutros cuando faltan datos', () => {
    const message = buildCheckoutRejectWhatsAppMessage({
      bookerName: null,
      seatCodes: [],
      origin: null,
      destination: null,
      departureLabel: null,
      agencyName: null,
      reason: null,
    });
    expect(message).toContain('Hola cliente:');
    expect(message).toContain('los asientos —');
    expect(message).toContain('— → —');
    expect(message).toContain('con la agencia la agencia fue rechazado.');
    expect(message).toContain('Motivo: —');
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('null');
  });
});
