import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/database.js';
import { NotFoundError, AgencyInactiveError } from '../errors/index.js';

const UNLOCK_PATHS = ['/seats/unlock', '/seats/unlock-all', '/seats/unlock-all-user'];

export async function tenant(req: Request, _res: Response, next: NextFunction) {
  const agencyId = req.ctx?.agencyId;

  if (!agencyId) {
    throw new NotFoundError('Agency not found');
  }

  const { data: agency, error } = await supabase
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
