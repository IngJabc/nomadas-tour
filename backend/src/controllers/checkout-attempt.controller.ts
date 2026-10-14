import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../errors/index.js';
import { checkoutAttemptService } from '../services/checkout-attempt.service.js';

const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;

const uuidSchema = z.string().uuid();

const listQuerySchema = z.object({
  status: z
    .enum([
      'created',
      'pending_review',
      'rejected',
      'verified',
      'rejected_final',
      'expired',
      'cancelled',
    ])
    .optional(),
  trip_id: uuidSchema.optional(),
  q: z.string().trim().max(120).optional(),
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

export class CheckoutAttemptController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = parseOrThrow(listQuerySchema, req.query);

      const result = await checkoutAttemptService.list({
        agencyId: requireAgencyId(req),
        status: query.status,
        tripId: query.trip_id,
        q: query.q,
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
      const { attemptId } = parseOrThrow(
        z.object({ attemptId: uuidSchema }),
        req.params,
      );

      const result = await checkoutAttemptService.getDetail({
        attemptId,
        agencyId: requireAgencyId(req),
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getProof(req: Request, res: Response, next: NextFunction) {
    try {
      const { attemptId } = parseOrThrow(
        z.object({ attemptId: uuidSchema }),
        req.params,
      );

      const result = await checkoutAttemptService.getProofSignedUrl({
        attemptId,
        agencyId: requireAgencyId(req),
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const { attemptId } = parseOrThrow(
        z.object({ attemptId: uuidSchema }),
        req.params,
      );

      const result = await checkoutAttemptService.verify({
        attemptId,
        actorUserId: req.ctx!.userId,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async reject(req: Request, res: Response, next: NextFunction) {
    try {
      const { attemptId } = parseOrThrow(
        z.object({ attemptId: uuidSchema }),
        req.params,
      );
      const { reason } = parseOrThrow(rejectBodySchema, req.body);

      const result = await checkoutAttemptService.reject({
        attemptId,
        actorUserId: req.ctx!.userId,
        reason,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const checkoutAttemptController = new CheckoutAttemptController();
