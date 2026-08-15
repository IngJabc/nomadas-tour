import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../errors/index.js';
import { auditService } from '../services/audit.service.js';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  type AuditQueryFilters,
} from '../types/audit.js';
import { decodeAuditCursor } from '../utils/audit-cursor.js';

const DAY_MS = 86_400_000;
export const MAX_AUDIT_RANGE_MS = 90 * DAY_MS;

const isoDatetime = z
  .string()
  .min(1)
  .refine((v) => Number.isFinite(Date.parse(v)), {
    message: 'Invalid ISO 8601 datetime',
  });

const baseAuditQueryFields = {
  from: isoDatetime.optional(),
  to: isoDatetime.optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  entity_type: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entity_id: z.string().uuid().optional(),
  actor_user_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
};

/**
 * F5-002.1 F-1 — 90-day temporal bounds.
 * Case A: from+to → to>=from && span<=90d
 * Case B: from only → now-from <=90d
 * Case C: to only → now-to <=90d (query also clamps from=to-90d)
 * Case D: neither → no artificial window
 */
export function refineAuditTimeBounds(
  data: { from?: string; to?: string },
  ctx: z.RefinementCtx,
  nowMs: number = Date.now(),
) {
  const hasFrom = data.from !== undefined;
  const hasTo = data.to !== undefined;

  if (hasFrom && hasTo) {
    const fromMs = Date.parse(data.from!);
    const toMs = Date.parse(data.to!);
    if (toMs < fromMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'to must be greater than or equal to from',
      });
    } else if (toMs - fromMs > MAX_AUDIT_RANGE_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Date range must not exceed 90 days',
      });
    }
    return;
  }

  if (hasFrom && !hasTo) {
    const fromMs = Date.parse(data.from!);
    if (nowMs - fromMs > MAX_AUDIT_RANGE_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'from must be within the last 90 days',
      });
    }
    return;
  }

  if (!hasFrom && hasTo) {
    const toMs = Date.parse(data.to!);
    if (nowMs - toMs > MAX_AUDIT_RANGE_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'to must be within the last 90 days',
      });
    }
  }
}

/**
 * Case C: when only `to` is provided, clamp the effective lower bound to to-90d.
 */
export function resolveAuditTimeFilters(
  from: string | undefined,
  to: string | undefined,
): { from?: string; to?: string } {
  if (!from && to) {
    const toMs = Date.parse(to);
    return {
      from: new Date(toMs - MAX_AUDIT_RANGE_MS).toISOString(),
      to,
    };
  }
  return { from, to };
}

function refineAuditQuery(
  data: {
    from?: string;
    to?: string;
    entity_id?: string;
    entity_type?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (data.entity_id && !data.entity_type) {
    ctx.addIssue({
      code: 'custom',
      path: ['entity_type'],
      message: 'entity_type is required when entity_id is provided',
    });
  }

  refineAuditTimeBounds(data, ctx);
}

export const adminAuditQuerySchema = z
  .object({
    ...baseAuditQueryFields,
    agency_id: z.string().uuid().optional(),
  })
  .strict()
  .superRefine(refineAuditQuery);

export const agencyAuditQuerySchema = z
  .object({
    ...baseAuditQueryFields,
  })
  .strict()
  .superRefine(refineAuditQuery);

function toFilters(
  parsed: z.infer<typeof adminAuditQuerySchema>,
): AuditQueryFilters {
  const time = resolveAuditTimeFilters(parsed.from, parsed.to);
  return {
    from: time.from,
    to: time.to,
    action: parsed.action,
    entity_type: parsed.entity_type,
    entity_id: parsed.entity_id,
    actor_user_id: parsed.actor_user_id,
    agency_id: 'agency_id' in parsed ? parsed.agency_id : undefined,
    limit: parsed.limit,
    cursor: parsed.cursor ? decodeAuditCursor(parsed.cursor) : undefined,
  };
}

function parseQuery<T>(
  schema: z.ZodType<T>,
  query: unknown,
): T {
  try {
    return schema.parse(query);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Invalid input', error.issues);
    }
    throw error;
  }
}

export class AuditController {
  async getAdminAudit(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = parseQuery(adminAuditQuerySchema, req.query);
      const filters = toFilters(parsed);
      const result = await auditService.getAdminAudit(filters);
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError('Invalid input', error.issues));
        return;
      }
      next(error);
    }
  }

  async getAgencyAudit(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        throw new ValidationError('Agency context required');
      }

      // Explicit rejection before strict schema (clearer than unrecognized_keys alone).
      if (
        Object.prototype.hasOwnProperty.call(req.query, 'agency_id')
      ) {
        throw new ValidationError('Invalid input', [
          {
            path: ['agency_id'],
            message: 'agency_id is not allowed for agency audit',
          },
        ]);
      }

      const parsed = parseQuery(agencyAuditQuerySchema, req.query);
      const filters = toFilters(parsed);
      const result = await auditService.getAgencyAudit(agencyId, filters);
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError('Invalid input', error.issues));
        return;
      }
      next(error);
    }
  }
}

export const auditController = new AuditController();
