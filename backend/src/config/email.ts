import { Resend } from 'resend';
import { env } from './env.js';

export const resend = new Resend(env.RESEND_API_KEY);

export const EMAIL_CONFIG = {
  from: env.EMAIL_FROM,
  frontendUrl: env.FRONTEND_URL,
} as const;
