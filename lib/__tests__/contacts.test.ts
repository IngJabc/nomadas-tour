import { describe, expect, it } from 'vitest';
import {
  CONTACT_CHANNEL_LABELS,
  PHONE_FORMAT_MESSAGE,
  PHONE_PATTERN,
  filterContactLabel,
  filterPhoneInput,
  isValidPhone,
  normalizePhone,
} from '../contacts';

describe('lib/contacts — teléfono del sistema (MKT-008)', () => {
  describe('normalizePhone', () => {
    it('quita separadores de presentación (espacios y guiones)', () => {
      expect(normalizePhone('0412 123 4567')).toBe('04121234567');
      expect(normalizePhone('+58-412-123-4567')).toBe('+584121234567');
      expect(normalizePhone(' 04121234567 ')).toBe('04121234567');
    });

    it('NO convierte el 0 nacional en 58 (no asume Venezuela)', () => {
      expect(normalizePhone('04121234567')).toBe('04121234567');
      expect(isValidPhone('04121234567')).toBe(true);
      expect(normalizePhone('020 7946 0958')).toBe('02079460958');
      expect(isValidPhone('02079460958')).toBe(true);
    });

    it('NO convierte el prefijo 00 en +', () => {
      expect(normalizePhone('00584121234567')).toBe('00584121234567');
      expect(isValidPhone('00584121234567')).toBe(false);
    });
  });

  describe('isValidPhone', () => {
    it('acepta 11 dígitos nacionales y + con 12 dígitos', () => {
      expect(isValidPhone('04121234567')).toBe(true);
      expect(isValidPhone('04241234567')).toBe(true);
      expect(isValidPhone('02079460958')).toBe(true);
      expect(isValidPhone('+584121234567')).toBe(true);
      expect(isValidPhone('+442079460958')).toBe(true);
      expect(isValidPhone('0412 123 4567')).toBe(true);
      expect(isValidPhone('+58 412 123 4567')).toBe(true);
    });

    it('rechaza vacíos, letras, cortos, largos y largos sin +', () => {
      expect(isValidPhone('')).toBe(false);
      expect(isValidPhone('   ')).toBe(false);
      expect(isValidPhone('hola')).toBe(false);
      expect(isValidPhone('041212')).toBe(false);
      expect(isValidPhone('+5841212345')).toBe(false);
      expect(isValidPhone('+14155552671')).toBe(false); // + y 11 dígitos
      expect(isValidPhone('584121234567')).toBe(false); // 12 dígitos sin +
      expect(isValidPhone('041212345678')).toBe(false); // 12 dígitos sin +
      expect(isValidPhone('0412h234567')).toBe(false);
      expect(isValidPhone('+58412123456789012345')).toBe(false);
    });

    it('la expresión alineada es el formato del sistema', () => {
      expect(PHONE_PATTERN.source).toBe('^(?:\\d{11}|\\+\\d{12})$');
    });

    it('expone el mensaje del resto del sistema', () => {
      expect(PHONE_FORMAT_MESSAGE).toBe('Formato: 0424xxxxxxx o +58424xxxxxxx');
    });
  });

  describe('filterPhoneInput (el input no admite letras)', () => {
    it('deja solo dígitos y un + inicial', () => {
      expect(filterPhoneInput('0412abc123')).toBe('0412123');
      expect(filterPhoneInput('+58abc412')).toBe('+58412');
      expect(filterPhoneInput('hola')).toBe('');
      expect(filterPhoneInput('+58 412 123 4567')).toBe('+584121234567');
    });

    it('limita a + y 12 dígitos, o a 13 caracteres sin +', () => {
      expect(filterPhoneInput('+584121234567890')).toBe('+584121234567');
      expect(filterPhoneInput('04121234567890123')).toBe('0412123456789');
    });

    it('mantiene el + solo al inicio', () => {
      expect(filterPhoneInput('04+12')).toBe('+0412');
      expect(filterPhoneInput('0412++')).toBe('+0412');
      expect(filterPhoneInput('0412')).toBe('0412');
    });
  });

  describe('filterContactLabel', () => {
    it('quita caracteres de control y limita a 60 caracteres', () => {
      expect(filterContactLabel('Central\u0000 WhatsApp')).toBe(
        'Central WhatsApp',
      );
      expect(filterContactLabel('Oficina\u0007\u001F')).toBe('Oficina');
      expect(filterContactLabel('x'.repeat(70))).toHaveLength(60);
      expect(filterContactLabel('Oficina Central 2')).toBe('Oficina Central 2');
    });
  });

  it('expone etiquetas de canal para ambos valores del CHECK', () => {
    expect(CONTACT_CHANNEL_LABELS.call).toBe('Llamada');
    expect(CONTACT_CHANNEL_LABELS.whatsapp).toBe('WhatsApp');
  });
});
