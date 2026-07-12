import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/database.js';
import { NotFoundError } from '../errors/index.js';

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
    throw new NotFoundError('Agency is not active');
  }

  next();
}
