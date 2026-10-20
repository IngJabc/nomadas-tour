import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../errors/index.js';
import {
  agencyContactService,
  type UpdateAgencyContactInput,
} from '../services/agency-contact.service.js';

/**
 * Teléfono con el formato del resto del sistema (espejo de isValidPhone
 * en lib/reservations/validateForm.ts y de lib/contacts.ts del
 * frontend): 11 dígitos nacionales (0424xxxxxxx) o «+» con 12 dígitos
 * (+58424xxxxxxx). Espejo del CHECK de la migración 091 y de
 * agency_contact_normalize_phone. NO convierte 0… a 58… (el formato
 * nacional se acepta tal cual).
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\d{11}|\+\d{12})$/, 'Formato: 0424xxxxxxx o +58424xxxxxxx');

export const contactChannelSchema = z.enum(['call', 'whatsapp']);

export const createContactSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, 'Indica un nombre corto (máx. 60 caracteres).')
      .max(60, 'Indica un nombre corto (máx. 60 caracteres).'),
    phone: phoneSchema,
    channel: contactChannelSchema,
    is_public: z.boolean().optional(),
    sort_order: z
      .number()
      .int('El orden debe ser un número entero.')
      .min(0, 'El orden no puede ser negativo.')
      .max(1000, 'El orden debe estar entre 0 y 1000.')
      .optional(),
  })
  .strict();

export const updateContactSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, 'Indica un nombre corto (máx. 60 caracteres).')
      .max(60, 'Indica un nombre corto (máx. 60 caracteres).')
      .optional(),
    phone: phoneSchema.optional(),
    channel: contactChannelSchema.optional(),
    is_public: z.boolean().optional(),
    sort_order: z
      .number()
      .int('El orden debe ser un número entero.')
      .min(0, 'El orden no puede ser negativo.')
      .max(1000, 'El orden debe estar entre 0 y 1000.')
      .optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.label !== undefined ||
      value.phone !== undefined ||
      value.channel !== undefined ||
      value.is_public !== undefined ||
      value.sort_order !== undefined ||
      value.is_active !== undefined,
    { message: 'No se enviaron cambios para el contacto' },
  );

function requireAgencyId(req: Request): string {
  const agencyId = req.ctx?.agencyId;
  if (!agencyId) {
    throw new ValidationError('Agency context required');
  }
  return agencyId;
}

function requireContactId(req: Request): string {
  const contactId = req.params.id as string;
  if (
    !contactId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      contactId,
    )
  ) {
    throw new NotFoundError('Contacto no encontrado');
  }
  return contactId;
}

function zodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Entrada inválida';
}

export class AgencyContactController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const contacts = await agencyContactService.list(requireAgencyId(req));
      res.json({ contacts });
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createContactSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(zodMessage(parsed.error));
      }

      const contact = await agencyContactService.create(
        requireAgencyId(req),
        req.ctx!.userId,
        parsed.data,
      );
      res.status(201).json({ contact });
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
      const parsed = updateContactSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(zodMessage(parsed.error));
      }

      const contact = await agencyContactService.update(
        requireAgencyId(req),
        req.ctx!.userId,
        requireContactId(req),
        parsed.data as UpdateAgencyContactInput,
      );
      res.json({ contact });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError('Entrada inválida', error.issues));
        return;
      }
      next(error);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await agencyContactService.remove(
        requireAgencyId(req),
        req.ctx!.userId,
        requireContactId(req),
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const agencyContactController = new AgencyContactController();
