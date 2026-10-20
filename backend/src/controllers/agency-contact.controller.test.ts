import { describe, expect, it, vi } from 'vitest';

// El controller importa el service, que importa config/database (env).
// Aquí solo se ejercitan los schemas Zod: el service se sustituye.
vi.mock('../services/agency-contact.service.js', () => ({
  agencyContactService: {},
  CONTACT_COLUMNS: '',
}));

import {
  createContactSchema,
  phoneSchema,
  updateContactSchema,
} from './agency-contact.controller.js';

const BASE = {
  label: 'Central WhatsApp',
  phone: '+584121234567',
  channel: 'whatsapp' as const,
};

describe('agency-contact.controller — schemas Zod (MKT-008)', () => {
  describe('sort_order: contrato int 0..1000', () => {
    it('acepta sort_order = 0', () => {
      const result = createContactSchema.safeParse({
        ...BASE,
        sort_order: 0,
      });
      expect(result.success).toBe(true);
      expect(result.data?.sort_order).toBe(0);
    });

    it('acepta sort_order = 1000', () => {
      const result = createContactSchema.safeParse({
        ...BASE,
        sort_order: 1000,
      });
      expect(result.success).toBe(true);
      expect(result.data?.sort_order).toBe(1000);
    });

    it('rechaza sort_order = 1001 con mensaje en español', () => {
      const result = createContactSchema.safeParse({
        ...BASE,
        sort_order: 1001,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(
        'El orden debe estar entre 0 y 1000.',
      );
    });

    it('rechaza sort_order negativo con mensaje en español', () => {
      const result = createContactSchema.safeParse({
        ...BASE,
        sort_order: -1,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(
        'El orden no puede ser negativo.',
      );
    });

    it('rechaza sort_order no entero con mensaje en español', () => {
      const result = createContactSchema.safeParse({
        ...BASE,
        sort_order: 1.5,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(
        'El orden debe ser un número entero.',
      );
    });

    it('aplica el mismo contrato de sort_order en update', () => {
      expect(
        updateContactSchema.safeParse({ sort_order: 1000 }).success,
      ).toBe(true);
      const invalid = updateContactSchema.safeParse({ sort_order: 1001 });
      expect(invalid.success).toBe(false);
      expect(invalid.error?.issues[0]?.message).toBe(
        'El orden debe estar entre 0 y 1000.',
      );
    });
  });

  describe('label: mensajes en español', () => {
    it('rechaza label vacío con mensaje en español', () => {
      const result = createContactSchema.safeParse({ ...BASE, label: '   ' });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(
        'Indica un nombre corto (máx. 60 caracteres).',
      );
    });

    it('rechaza label de más de 60 caracteres con mensaje en español', () => {
      const result = createContactSchema.safeParse({
        ...BASE,
        label: 'x'.repeat(61),
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(
        'Indica un nombre corto (máx. 60 caracteres).',
      );
    });

    it('aplica el mismo mensaje de label en update', () => {
      const result = updateContactSchema.safeParse({ label: '' });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(
        'Indica un nombre corto (máx. 60 caracteres).',
      );
    });
  });

  describe('contrato estricto y teléfono del sistema', () => {
    it('rechaza agency_id inyectado en el body (.strict)', () => {
      const result = createContactSchema.safeParse({
        ...BASE,
        agency_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });
      expect(result.success).toBe(false);
    });

    it('acepta el formato del sistema: 11 dígitos y + con 12 dígitos', () => {
      expect(phoneSchema.safeParse('04121234567').success).toBe(true);
      expect(phoneSchema.safeParse('04241234567').success).toBe(true);
      expect(phoneSchema.safeParse('+584121234567').success).toBe(true);
      expect(phoneSchema.safeParse(' 04121234567 ').success).toBe(true);
    });

    it('rechaza letras y largos fuera de contrato con mensaje en español', () => {
      for (const invalid of [
        '0412h234567',
        '041212',
        '+5841212345',
        '+14155552671', // + y 11 dígitos
        '584121234567', // 12 dígitos sin +
        '00584121234567',
      ]) {
        const result = phoneSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toBe(
          'Formato: 0424xxxxxxx o +58424xxxxxxx',
        );
      }
    });

    it('el update exige al menos un campo', () => {
      expect(updateContactSchema.safeParse({}).success).toBe(false);
    });
  });
});
