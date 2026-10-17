import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppError,
  NotFoundError,
  ValidationError,
} from '../errors/index.js';

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

import { agencyPaymentMethodService } from './agency-payment-method.service.js';

const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_1 = '33333333-3333-4333-8333-333333333333';
const METHOD_1 = '99999999-9999-4999-8999-999999999999';

const VALID_DATA = {
  bank_name: 'Banesco',
  phone: '04121234567',
  document_type: 'V',
  document_number: '12345678',
  account_holder: 'Agencia Central',
};

function methodRow(partial: Record<string, unknown> = {}) {
  return {
    id: METHOD_1,
    agency_id: AGENCY_A,
    method: 'pago_movil',
    label: 'Pago Móvil Banesco',
    data: VALID_DATA,
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
  for (const key of Object.keys(tableChains)) {
    delete tableChains[key];
  }
});

describe('AgencyPaymentMethodService (MKT-007.4)', () => {
  describe('list', () => {
    it('lista los canales vivos y excluye los borrados', async () => {
      tableChains['agency_payment_methods'] = createChainable({
        data: [methodRow()],
        error: null,
      });

      const result = await agencyPaymentMethodService.list(AGENCY_A);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(METHOD_1);
      expect(result[0].method).toBe('pago_movil');
      expect(result[0].data).toEqual(VALID_DATA);
      expect(result[0].deleted_at).toBeNull();

      const chain = tableChains['agency_payment_methods'];
      expect(chain.eq).toHaveBeenCalledWith('agency_id', AGENCY_A);
      expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
      expect(chain.order).toHaveBeenCalledWith('is_primary', {
        ascending: false,
      });
      expect(chain.order).toHaveBeenCalledWith('sort_order', {
        ascending: true,
      });
    });

    it('devuelve [] cuando la agencia no tiene canales', async () => {
      tableChains['agency_payment_methods'] = createChainable({
        data: [],
        error: null,
      });

      const result = await agencyPaymentMethodService.list(AGENCY_A);

      expect(result).toEqual([]);
    });

    it('propaga el error de la base de datos como ValidationError', async () => {
      tableChains['agency_payment_methods'] = createChainable({
        data: null,
        error: { message: 'boom' },
      });

      await expect(agencyPaymentMethodService.list(AGENCY_A)).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('create', () => {
    it('crea el canal vía RPC y normaliza la respuesta', async () => {
      mockRpc.mockResolvedValue({
        data: { payment_method: methodRow() },
        error: null,
      });

      const result = await agencyPaymentMethodService.create(
        AGENCY_A,
        ACTOR_1,
        {
          method: 'pago_movil',
          label: 'Pago Móvil Banesco',
          data: VALID_DATA,
          is_primary: true,
        },
      );

      expect(mockRpc).toHaveBeenCalledWith('create_agency_payment_method', {
        p_agency_id: AGENCY_A,
        p_actor_user_id: ACTOR_1,
        p_method: 'pago_movil',
        p_label: 'Pago Móvil Banesco',
        p_data: VALID_DATA,
        p_is_primary: true,
        p_sort_order: 0,
      });
      expect(result.id).toBe(METHOD_1);
      expect(result.is_primary).toBe(true);
      expect(result.data).toEqual(VALID_DATA);
    });

    it('mapea ERR_AGENCY_HAS_ACTIVE_CHECKOUTS a 409', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          message:
            'ERR_AGENCY_HAS_ACTIVE_CHECKOUTS: compras activas en curso',
        },
      });

      const error = await agencyPaymentMethodService
        .create(AGENCY_A, ACTOR_1, {
          method: 'pago_movil',
          label: 'Otro canal',
          data: VALID_DATA,
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(409);
      expect((error as AppError).code).toBe('AGENCY_HAS_ACTIVE_CHECKOUTS');
    });

    it('mapea ERR_PAYMENT_METHOD_DATA a ValidationError', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: {
          message: 'ERR_PAYMENT_METHOD_DATA: el teléfono no es válido',
        },
      });

      await expect(
        agencyPaymentMethodService.create(AGENCY_A, ACTOR_1, {
          method: 'pago_movil',
          label: 'Canal',
          data: VALID_DATA,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('responde NotFoundError si la RPC no devuelve canal', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      await expect(
        agencyPaymentMethodService.create(AGENCY_A, ACTOR_1, {
          method: 'pago_movil',
          label: 'Canal',
          data: VALID_DATA,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('update', () => {
    it('actualiza vía RPC con solo los campos enviados', async () => {
      mockRpc.mockResolvedValue({
        data: {
          payment_method: methodRow({ label: 'Pago Móvil Provincial' }),
        },
        error: null,
      });

      const result = await agencyPaymentMethodService.update(
        AGENCY_A,
        ACTOR_1,
        METHOD_1,
        { label: 'Pago Móvil Provincial' },
      );

      expect(mockRpc).toHaveBeenCalledWith('update_agency_payment_method', {
        p_agency_id: AGENCY_A,
        p_actor_user_id: ACTOR_1,
        p_method_id: METHOD_1,
        p_label: 'Pago Móvil Provincial',
        p_data: null,
        p_is_active: null,
      });
      expect(result.label).toBe('Pago Móvil Provincial');
    });

    it('mapea ERR_AGENCY_HAS_ACTIVE_CHECKOUTS a 409 también en update', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'ERR_AGENCY_HAS_ACTIVE_CHECKOUTS: frozen' },
      });

      const error = await agencyPaymentMethodService
        .update(AGENCY_A, ACTOR_1, METHOD_1, { is_active: false })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(409);
    });
  });

  describe('setPrimary', () => {
    it('marca el canal como primario vía RPC', async () => {
      mockRpc.mockResolvedValue({
        data: { payment_method: methodRow({ is_primary: true }) },
        error: null,
      });

      const result = await agencyPaymentMethodService.setPrimary(
        AGENCY_A,
        ACTOR_1,
        METHOD_1,
      );

      expect(mockRpc).toHaveBeenCalledWith('set_agency_payment_method_primary', {
        p_agency_id: AGENCY_A,
        p_actor_user_id: ACTOR_1,
        p_method_id: METHOD_1,
      });
      expect(result.is_primary).toBe(true);
    });

    it('mapea ERR_PAYMENT_METHOD_NOT_FOUND a 404', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'ERR_PAYMENT_METHOD_NOT_FOUND: no existe' },
      });

      await expect(
        agencyPaymentMethodService.setPrimary(AGENCY_A, ACTOR_1, METHOD_1),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('remove', () => {
    it('borra suavemente y reporta audit_id y already_deleted', async () => {
      mockRpc.mockResolvedValue({
        data: {
          payment_method: methodRow({
            deleted_at: '2026-10-02T10:00:00.000Z',
          }),
          audit_id: 'audit-1',
          already_deleted: false,
        },
        error: null,
      });

      const result = await agencyPaymentMethodService.remove(
        AGENCY_A,
        ACTOR_1,
        METHOD_1,
      );

      expect(mockRpc).toHaveBeenCalledWith('delete_agency_payment_method', {
        p_agency_id: AGENCY_A,
        p_actor_user_id: ACTOR_1,
        p_method_id: METHOD_1,
      });
      expect(result.audit_id).toBe('audit-1');
      expect(result.already_deleted).toBe(false);
      expect(result.payment_method.deleted_at).toBe('2026-10-02T10:00:00.000Z');
    });

    it('reporta already_deleted=true cuando ya estaba borrado', async () => {
      mockRpc.mockResolvedValue({
        data: {
          payment_method: methodRow({
            deleted_at: '2026-10-01T09:00:00.000Z',
          }),
          audit_id: 'audit-2',
          already_deleted: true,
        },
        error: null,
      });

      const result = await agencyPaymentMethodService.remove(
        AGENCY_A,
        ACTOR_1,
        METHOD_1,
      );

      expect(result.already_deleted).toBe(true);
    });
  });
});
