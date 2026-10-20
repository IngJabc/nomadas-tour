import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, ValidationError } from '../errors/index.js';

type ChainResult = {
  data: unknown;
  error: { message: string } | null;
};

function createChainable(result: ChainResult = { data: [], error: null }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.is = vi.fn(self);
  chain.order = vi.fn(self);
  chain.then = (
    resolve: (v: ChainResult) => void,
    reject?: (e: unknown) => void,
  ) => {
    Promise.resolve(result).then(resolve, reject);
  };
  return chain as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    then: (
      resolve: (v: ChainResult) => void,
      reject?: (e: unknown) => void,
    ) => void;
  };
}

const tableChains: Record<string, ReturnType<typeof createChainable>> = {};

const mockFrom = vi.fn((table: string) => {
  if (!tableChains[table]) {
    tableChains[table] = createChainable();
  }
  return tableChains[table];
});

const mockRpc = vi.fn();

vi.mock('../config/database.js', () => ({
  supabaseAdmin: {
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { agencyContactService } from './agency-contact.service.js';

const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_1 = '33333333-3333-4333-8333-333333333333';
const CONTACT_1 = '99999999-9999-4999-8999-999999999999';

function contactRow(partial: Record<string, unknown> = {}) {
  return {
    id: CONTACT_1,
    agency_id: AGENCY_A,
    label: 'Central WhatsApp',
    phone: '+584121234567',
    channel: 'whatsapp',
    is_active: true,
    is_public: true,
    sort_order: 0,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    deleted_at: null,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('AgencyContactService (MKT-008)', () => {
  describe('list', () => {
    it('lista los contactos vivos y excluye los borrados', async () => {
      tableChains['agency_contacts'] = createChainable({
        data: [contactRow()],
        error: null,
      });

      const result = await agencyContactService.list(AGENCY_A);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(CONTACT_1);
      expect(result[0].phone).toBe('+584121234567');
      expect(result[0].channel).toBe('whatsapp');
      expect(result[0].deleted_at).toBeNull();

      const chain = tableChains['agency_contacts'];
      expect(chain.eq).toHaveBeenCalledWith('agency_id', AGENCY_A);
      expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
      expect(chain.order).toHaveBeenCalledWith('sort_order', {
        ascending: true,
      });
      expect(chain.order).toHaveBeenCalledWith('created_at', {
        ascending: true,
      });
    });

    it('devuelve [] cuando la agencia no tiene contactos', async () => {
      tableChains['agency_contacts'] = createChainable({
        data: [],
        error: null,
      });

      const result = await agencyContactService.list(AGENCY_A);

      expect(result).toEqual([]);
    });

    it('propaga el error de la base de datos como ValidationError', async () => {
      tableChains['agency_contacts'] = createChainable({
        data: null,
        error: { message: 'boom' },
      });

      await expect(agencyContactService.list(AGENCY_A)).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('create', () => {
    it('crea el contacto vía RPC con agency_id del tenant y normaliza la respuesta', async () => {
      mockRpc.mockResolvedValue({
        data: { contact: contactRow() },
        error: null,
      });

      const result = await agencyContactService.create(AGENCY_A, ACTOR_1, {
        label: 'Central WhatsApp',
        phone: '+584121234567',
        channel: 'whatsapp',
        is_public: true,
      });

      expect(mockRpc).toHaveBeenCalledWith('create_agency_contact', {
        p_agency_id: AGENCY_A,
        p_actor_user_id: ACTOR_1,
        p_label: 'Central WhatsApp',
        p_phone: '+584121234567',
        p_channel: 'whatsapp',
        p_is_public: true,
        p_sort_order: 0,
      });
      expect(result.id).toBe(CONTACT_1);
      expect(result.is_public).toBe(true);
    });

    it('mapea ERR_CONTACT_DUPLICATE a ValidationError con mensaje claro', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          message: 'ERR_CONTACT_DUPLICATE: duplicado',
        },
      });

      await expect(
        agencyContactService.create(AGENCY_A, ACTOR_1, {
          label: 'Otro',
          phone: '+584121234567',
          channel: 'call',
        }),
      ).rejects.toThrow(/Ya existe un contacto/);
    });

    it('mapea ERR_CONTACT_DATA a ValidationError', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          message:
            'ERR_CONTACT_DATA: phone must match 0424xxxxxxx or +58424xxxxxxx',
        },
      });

      await expect(
        agencyContactService.create(AGENCY_A, ACTOR_1, {
          label: 'Central',
          phone: '+584121234567',
          channel: 'call',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('mapea ERR_CONTACT_AGENCY a ValidationError (ownership)', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'ERR_CONTACT_AGENCY: not yours' },
      });

      await expect(
        agencyContactService.create(AGENCY_A, ACTOR_1, {
          label: 'Central',
          phone: '+584121234567',
          channel: 'call',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('responde NotFoundError si la RPC no devuelve contacto', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      await expect(
        agencyContactService.create(AGENCY_A, ACTOR_1, {
          label: 'Central',
          phone: '+584121234567',
          channel: 'call',
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('update', () => {
    it('actualiza vía RPC con solo los campos enviados y sin agency_id del cliente', async () => {
      mockRpc.mockResolvedValue({
        data: { contact: contactRow({ label: 'Oficina' }) },
        error: null,
      });

      const result = await agencyContactService.update(
        AGENCY_A,
        ACTOR_1,
        CONTACT_1,
        { label: 'Oficina' },
      );

      expect(mockRpc).toHaveBeenCalledWith('update_agency_contact', {
        p_agency_id: AGENCY_A,
        p_actor_user_id: ACTOR_1,
        p_contact_id: CONTACT_1,
        p_label: 'Oficina',
        p_phone: null,
        p_channel: null,
        p_is_public: null,
        p_sort_order: null,
        p_is_active: null,
      });
      expect(result.label).toBe('Oficina');
    });

    it('mapea ERR_CONTACT_NOT_FOUND a NotFoundError', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'ERR_CONTACT_NOT_FOUND: no existe' },
      });

      await expect(
        agencyContactService.update(AGENCY_A, ACTOR_1, CONTACT_1, {
          is_active: false,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('mapea ERR_CONTACT_DUPLICATE también en update', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'ERR_CONTACT_DUPLICATE: duplicado' },
      });

      await expect(
        agencyContactService.update(AGENCY_A, ACTOR_1, CONTACT_1, {
          phone: '+584121234567',
        }),
      ).rejects.toThrow(/Ya existe un contacto/);
    });
  });

  describe('remove', () => {
    it('borra suavemente y reporta audit_id y already_deleted', async () => {
      mockRpc.mockResolvedValue({
        data: {
          contact: contactRow({ deleted_at: '2026-10-02T10:00:00.000Z' }),
          audit_id: 'audit-1',
          already_deleted: false,
        },
        error: null,
      });

      const result = await agencyContactService.remove(
        AGENCY_A,
        ACTOR_1,
        CONTACT_1,
      );

      expect(mockRpc).toHaveBeenCalledWith('delete_agency_contact', {
        p_agency_id: AGENCY_A,
        p_actor_user_id: ACTOR_1,
        p_contact_id: CONTACT_1,
      });
      expect(result.audit_id).toBe('audit-1');
      expect(result.already_deleted).toBe(false);
      expect(result.contact.deleted_at).toBe('2026-10-02T10:00:00.000Z');
    });

    it('reporta already_deleted=true cuando ya estaba borrado', async () => {
      mockRpc.mockResolvedValue({
        data: {
          contact: contactRow({ deleted_at: '2026-10-01T09:00:00.000Z' }),
          audit_id: 'audit-2',
          already_deleted: true,
        },
        error: null,
      });

      const result = await agencyContactService.remove(
        AGENCY_A,
        ACTOR_1,
        CONTACT_1,
      );

      expect(result.already_deleted).toBe(true);
    });
  });
});
