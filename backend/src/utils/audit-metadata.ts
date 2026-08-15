import type { Request } from 'express';

/** Safe request metadata for audit_log (no auth headers / cookies / tokens). */
export function auditRequestMetadata(req: Request): {
  source: 'api';
  ip?: string;
  user_agent?: string;
} {
  const meta: {
    source: 'api';
    ip?: string;
    user_agent?: string;
  } = { source: 'api' };

  const ip = req.ip || req.socket?.remoteAddress;
  if (ip) meta.ip = ip;

  const ua = req.get('user-agent');
  if (ua) meta.user_agent = ua;

  return meta;
}
