import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/database.js';
import { UnauthorizedError } from '../errors/index.js';
import { RequestContext } from '../types/index.js';

declare global {
  namespace Express {
    interface Request {
      ctx?: RequestContext;
    }
  }
}

function extractContext(user: { id: string; user_metadata?: Record<string, unknown> }): RequestContext {
  return {
    userId: user.id,
    role: (user.user_metadata?.role as RequestContext['role']),
    agencyId: (user.user_metadata?.agency_id as string) ?? null,
  };
}

export async function auth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Falta o es inválido el encabezado de autorización');
  }

  const token = header.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new UnauthorizedError('Token inválido o expirado');
  }

  req.ctx = extractContext(user);
  next();
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = header.slice(7);
  const { data: { user } } = await supabase.auth.getUser(token);

  if (user) {
    req.ctx = extractContext(user);
  }
  next();
}
