import { Request, Response, NextFunction } from 'express';
import { supabase, supabaseAdmin } from '../config/database.js';
import { UnauthorizedError } from '../errors/index.js';
import { RequestContext } from '../types/index.js';

declare global {
  namespace Express {
    interface Request {
      ctx?: RequestContext;
    }
  }
}

async function extractContext(user: { id: string }): Promise<RequestContext> {
  const { data: dbUser, error } = await supabaseAdmin
    .from('users')
    .select('id, role, agency_id')
    .eq('id', user.id)
    .maybeSingle();

  // SEC-009.3 DIAGNOSTIC — temporary, revert after evidence captured
  console.log('[SEC-009.3 AUTH DEBUG] extractContext result:', {
    dbUserFound: !!dbUser,
    dbUserError: error?.message,
    dbUserErrorCode: (error as any)?.code,
    dbUserRole: dbUser?.role,
    dbUserAgencyId: dbUser?.agency_id,
    userId: user.id,
  });

  if (error || !dbUser) {
    throw new UnauthorizedError('Usuario no registrado');
  }

  if (dbUser.role !== 'superadmin' && dbUser.role !== 'agency') {
    console.log('[SEC-009.3 AUTH DEBUG] extractContext REJECTED: role is', dbUser.role, 'not superadmin/agency');
    throw new UnauthorizedError('Usuario no registrado');
  }

  console.log('[SEC-009.3 AUTH DEBUG] extractContext PASSED for userId:', user.id);
  return {
    userId: dbUser.id,
    role: dbUser.role as RequestContext['role'],
    agencyId: dbUser.agency_id ?? null,
  };
}

export async function auth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Falta o es inválido el encabezado de autorización');
  }

  const token = header.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  // SEC-009.3 DIAGNOSTIC — temporary, revert after evidence captured
  console.log('[SEC-009.3 AUTH DEBUG]', {
    errorName: error?.name,
    errorMessage: error?.message,
    errorStatus: (error as any)?.status,
    errorCode: (error as any)?.code,
    userId: user?.id,
    userEmail: user?.email,
    hasUser: !!user,
  });

  if (error || !user) {
    throw new UnauthorizedError('Token inválido o expirado');
  }

  // SEC-009.3 DIAGNOSTIC — track which 401 source triggers
  console.log('[SEC-009.3 AUTH DEBUG] getUser() PASSED, calling extractContext for userId:', user.id);

  req.ctx = await extractContext(user);
  next();
}
