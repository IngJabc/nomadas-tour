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
      await authService.forgotPassword(data.email);
      res.json({ message: 'Si existe una cuenta con este correo, se ha enviado un enlace de recuperación.' });
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Datos inválidos', (error as any).issues) : error);
    }
  }
}

export const authController = new AuthController();
