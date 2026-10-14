import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../errors/index.js';
import { paymentService } from '../services/payment.service.js';

const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;

const uuidSchema = z.string().uuid();

const listQuerySchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
});

const rejectBodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Invalid input', result.error.issues);
  }
  return result.data;
}

function requireAgencyId(req: Request): string {
  const agencyId = req.ctx?.agencyId;
  if (!agencyId) {
    throw new ValidationError('Agency context required');
  }
  return agencyId;
}

export class PaymentController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = parseOrThrow(listQuerySchema, req.query);

      const result = await paymentService.listAgencyPayments({
        agencyId: requireAgencyId(req),
        status: query.status,
        page: query.page,
        limit: query.limit,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { paymentId } = parseOrThrow(
        z.object({ paymentId: uuidSchema }),
        req.params,
      );

      const result = await paymentService.getAgencyPaymentDetail({
        paymentId,
        agencyId: requireAgencyId(req),
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getProof(req: Request, res: Response, next: NextFunction) {
    try {
      const { paymentId } = parseOrThrow(
        z.object({ paymentId: uuidSchema }),
        req.params,
      );

      const result = await paymentService.getPaymentProofSignedUrl({
        paymentId,
        agencyId: requireAgencyId(req),
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const { paymentId } = parseOrThrow(
        z.object({ paymentId: uuidSchema }),
        req.params,
      );

      const result = await paymentService.verifyPayment({
        paymentId,
        actorUserId: req.ctx!.userId,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async reject(req: Request, res: Response, next: NextFunction) {
    try {
      const { paymentId } = parseOrThrow(
        z.object({ paymentId: uuidSchema }),
        req.params,
      );
      const { reason } = parseOrThrow(rejectBodySchema, req.body);

      const result = await paymentService.rejectPayment({
        paymentId,
        actorUserId: req.ctx!.userId,
        reason,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const paymentController = new PaymentController();
