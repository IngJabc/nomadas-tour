import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { reservationLinkService } from '../services/reservation-link.service.js';
import { ValidationError } from '../errors/index.js';

const DOCUMENT_RE = /^\d{7,8}$/;
const PHONE_STRIP_RE = /[\s\-]/g;

function isValidPhone(phone: string): boolean {
  const stripped = phone.replace(PHONE_STRIP_RE, '');
  if (/^\d{11}$/.test(stripped)) return true;
  if (/^\+\d{12}$/.test(stripped)) return true;
  return false;
}

const passengerSchema = z.object({
  seat_code: z.string().min(1),
  name: z.string().optional().default('').refine(
    (val) => !val || val.trim().length >= 2,
    { message: 'Mínimo 2 caracteres' },
  ),
  document: z.string().optional().default('').refine(
    (val) => !val || DOCUMENT_RE.test(val.trim()),
    { message: 'Debe tener 7 u 8 dígitos' },
  ),
  phone: z.string().optional().default('').refine(
    (val) => !val || val.trim() === '' || isValidPhone(val.trim()),
    { message: 'Formato: 0424xxxxxxx o +58424xxxxxxx' },
  ),
});

const linkDataSchema = z.object({
  booker_name: z.string().optional().default('').refine(
    (val) => !val || val.trim().length >= 2,
    { message: 'Mínimo 2 caracteres' },
  ),
  booker_document: z.string().optional().default('').refine(
    (val) => !val || DOCUMENT_RE.test(val.trim()),
    { message: 'Debe tener 7 u 8 dígitos' },
  ),
  booker_phone: z.string().optional().default('').refine(
    (val) => !val || val.trim() === '' || isValidPhone(val.trim()),
    { message: 'Formato: 0424xxxxxxx o +58424xxxxxxx' },
  ),
  passengers: z.array(passengerSchema).min(1),
});

const createSchema = z.object({
  trip_id: z.string().uuid(),
  seat_ids: z.array(z.string().uuid()).min(1),
});

export class ReservationLinkController {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const body = createSchema.parse(req.body);
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Agency ID not found' } });
        return;
      }
      const result = await reservationLinkService.createLink(
        body.trip_id,
        body.seat_ids,
        agencyId,
        req.ctx!.userId,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', error.issues) : error);
    }
  }

  async confirm(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Agency ID not found' } });
        return;
      }
      const result = await reservationLinkService.confirm(
        req.params.id as string,
        agencyId,
        req.ctx!.userId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Agency ID not found' } });
        return;
      }
      const result = await reservationLinkService.cancel(req.params.id as string, agencyId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async invalidate(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Agency ID not found' } });
        return;
      }
      const result = await reservationLinkService.invalidate(req.params.id as string, agencyId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async regenerate(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Agency ID not found' } });
        return;
      }
      const result = await reservationLinkService.regenerate(
        req.params.id as string,
        agencyId,
        req.ctx!.userId,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async patchData(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Agency ID not found' } });
        return;
      }
      const parsed = z.object({ link_data: linkDataSchema }).parse(req.body);
      const result = await reservationLinkService.patchData(
        req.params.id as string,
        agencyId,
        parsed.link_data,
      );
      res.json({ link_data: result });
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', error.issues) : error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Agency ID not found' } });
        return;
      }
      const result = await reservationLinkService.list(agencyId, {
        trip_id: typeof req.query.trip_id === 'string' ? req.query.trip_id : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Agency ID not found' } });
        return;
      }
      const result = await reservationLinkService.getById(req.params.id as string, agencyId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async publicGet(req: Request, res: Response, next: NextFunction) {
    try {
      const token = String(req.params.token || '');
      const result = await reservationLinkService.publicGet(token);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async publicSave(req: Request, res: Response, next: NextFunction) {
    try {
      const token = String(req.params.token || '');
      const body = linkDataSchema.parse(req.body);
      const result = await reservationLinkService.publicSave(token, body);
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', error.issues) : error);
    }
  }
}

export const reservationLinkController = new ReservationLinkController();
