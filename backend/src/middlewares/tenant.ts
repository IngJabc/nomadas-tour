import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/database.js';
import { NotFoundError } from '../errors/index.js';

export async function tenant(req: Request, _res: Response, next: NextFunction) {
  const host = req.headers.host || '';
  const parts = host.split('.');

  if (parts.length < 2) {
    next();
    return;
  }

  const subdomain = parts[0].toLowerCase();
  if (subdomain === 'admin' || subdomain === 'www' || subdomain === 'localhost') {
    next();
    return;
  }

  const { data: agency } = await supabase
    .from('agencies')
    .select('id, subdomain, status')
    .eq('subdomain', subdomain)
    .single();

  if (!agency) {
    throw new NotFoundError('Agency not found for this subdomain');
  }

  if (agency.status !== 'active') {
    throw new NotFoundError('Agency is not active');
  }

  req.ctx = {
    userId: req.ctx?.userId || '',
    role: req.ctx?.role || 'agency',
    agencyId: req.ctx?.agencyId || agency.id,
  };

  next();
}
