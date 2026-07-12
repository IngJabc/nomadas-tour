import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../errors/index.js';
import { Role } from '../types/index.js';

export function authorize(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.ctx) {
      throw new ForbiddenError('Authentication required');
    }
    if (!allowedRoles.includes(req.ctx.role)) {
      throw new ForbiddenError('Insufficient permissions');
    }
    next();
  };
}
