import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../errors/index.js';
import {
  agencyPaymentMethodService,
  type UpdateAgencyPaymentMethodInput,
} from '../services/agency-payment-method.service.js';

const phoneSchema = z
  .string()
  .regex(/^04\d{9}$/, 'El teléfono móvil debe tener el formato 04XXXXXXXXX');

const bankCodeSchema = z
  .string()
  .regex(/^\d{4}$/, 'El código del banco debe tener 4 dígitos');

const documentTypeSchema = z.enum(['V', 'E', 'J', 'G']);

const documentNumberSchema = z
  .string()
  .regex(/^\d{6,9}$/, 'El número de documento debe tener entre 6 y 9 dígitos');

const accountTypeSchema = z.enum(['checking', 'savings']);

/** Datos del canal pago_movil: estricto para no persistir basura. */
export const pagoMovilDataSchema = z
  .object({
    bank_code: bankCodeSchema,
    bank_name: z.string().trim().min(1).max(80),
    phone: phoneSchema,
    document_type: documentTypeSchema,
    document_number: documentNumberSchema,
    holder_name: z.string().trim().min(1).max(120),
    account_type: accountTypeSchema.optional(),
    account_number: z
      .string()
      .trim()
      .regex(/^\d{1,30}$/, 'El número de cuenta debe contener solo dígitos')
      .optional(),
  })
  .strict();

export const createPaymentMethodSchema = z
  .object({
    method: z.literal('pago_movil'),
    label: z.string().trim().min(1).max(60),
    data: pagoMovilDataSchema,
    is_primary: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

export const updatePaymentMethodSchema = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    data: pagoMovilDataSchema.optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.label !== undefined ||
      value.data !== undefined ||
      value.is_active !== undefined,
    { message: 'No se enviaron cambios para el m�todo de pago' },
  );

function requireAgencyId(req: Request): string {
  const agencyId = req.ctx?.agencyId;
  if (!agencyId) {
    throw new ValidationError('Agency context required');
  }
  return agencyId;
}

function requireMethodId(req: Request): string {
  const methodId = req.params.id as string;
  if (!methodId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(methodId)) {
    throw new NotFoundError('M�todo de pago no encontrado');
  }
  return methodId;
}

function zodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Entrada inválida';
}

export class AgencyPaymentMethodController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const methods = await agencyPaymentMethodService.list(
        requireAgencyId(req),
      );
      res.json({ methods });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createPaymentMethodSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(zodMessage(parsed.error));
      }

      const method = await agencyPaymentMethodService.create(
        requireAgencyId(req),
        req.ctx!.userId,
        parsed.data,
      );
      res.status(201).json({ payment_method: method });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError('Entrada inválida', error.issues));
        return;
      }
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = updatePaymentMethodSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(zodMessage(parsed.error));
      }

      const method = await agencyPaymentMethodService.update(
        requireAgencyId(req),
        req.ctx!.userId,
        requireMethodId(req),
        parsed.data as UpdateAgencyPaymentMethodInput,
      );
      res.json({ payment_method: method });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError('Entrada inválida', error.issues));
        return;
      }
      next(error);
    }
  }

  async setPrimary(req: Request, res: Response, next: NextFunction) {
    try {
      const method = await agencyPaymentMethodService.setPrimary(
        requireAgencyId(req),
        req.ctx!.userId,
        requireMethodId(req),
      );
      res.json({ payment_method: method });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await agencyPaymentMethodService.remove(
        requireAgencyId(req),
        req.ctx!.userId,
        requireMethodId(req),
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const agencyPaymentMethodController = new AgencyPaymentMethodController();
