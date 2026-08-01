import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/database.js';
import { NotFoundError, AgencyInactiveError, ForbiddenError } from '../errors/index.js';

const UNLOCK_PATHS = ['/seats/unlock', '/seats/unlock-all', '/seats/unlock-all-user'];

export async function tenant(req: Request, _res: Response, next: NextFunction) {
  const userId = req.ctx?.userId;
  const agencyId = req.ctx?.agencyId;

  if (!userId || !agencyId) {
    throw new NotFoundError('Agency not found');
  }

  const { data: dbUser, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, role, agency_id')
    .eq('id', userId)
    .maybeSingle();

  if (userError || !dbUser || dbUser.role !== 'agency' || dbUser.agency_id !== agencyId) {
    throw new ForbiddenError('No tienes acceso a esta agencia');
  }

  const { data: agency, error } = await supabaseAdmin
    .from('agencies')
    .select('id, status')
    .eq('id', agencyId)
    .single();

  if (error || !agency) {
    throw new NotFoundError('Agency not found');
  }

  if (agency.status !== 'active') {
    const isUnlockOperation = UNLOCK_PATHS.some((p) => req.path.endsWith(p));
    if (isUnlockOperation) {
      return next();
    }
    throw new AgencyInactiveError();
  }

  next();
}
