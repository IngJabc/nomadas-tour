import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { z } from 'zod';
import { ValidationError } from '../errors/index.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const acceptInvitationSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6),
  confirm_password: z.string().min(6),
}).refine(data => data.password === data.confirm_password, {
  message: 'Las contraseñas no coinciden',
  path: ['confirm_password'],
});

const validateInvitationSchema = z.object({
  token: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().optional(),
  code: z.string().regex(/^\d{6}$/, 'El código debe ser de 6 dígitos').optional(),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  confirm_password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
}).refine(
  data => data.token || data.code,
  { message: 'Proporciona un código o un token' },
).refine(
  data => data.password === data.confirm_password,
  { message: 'Las contraseñas no coinciden', path: ['confirm_password'] },
);

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const data = loginSchema.parse(req.body);
      const result = await authService.login(data.email, data.password);
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Datos inválidos', (error as any).issues) : error);
    }
  }

  async validateInvitation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = validateInvitationSchema.parse(req.body);
      const result = await authService.validateInvitation(data.token);
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Datos inválidos', (error as any).issues) : error);
    }
  }

  async acceptInvitation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = acceptInvitationSchema.parse(req.body);
      const result = await authService.acceptInvitation(data.token, data.password);
      res.status(201).json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Datos inválidos', (error as any).issues) : error);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const data = forgotPasswordSchema.parse(req.body);
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      await authService.forgotPassword(data.email);
      console.log(`[Auth] Password reset requested — email: ${data.email}, ip: ${ip}`);
      res.json({ message: 'Si existe una cuenta con este correo, se ha enviado un enlace de recuperación.' });
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Datos inválidos', (error as any).issues) : error);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const data = resetPasswordSchema.parse(req.body);
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      const result = await authService.resetPassword(
        { token: data.token, code: data.code },
        data.password,
      );
      console.log(`[Auth] Password reset completed — user_id: ${result.user_id}, ip: ${ip}`);
      res.json({ message: result.message });
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Datos inválidos', (error as any).issues) : error);
    }
  }
}

export const authController = new AuthController();
