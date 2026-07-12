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
    message: 'Passwords do not match',
    path: ['confirm_password'],
});
const validateInvitationSchema = z.object({
    token: z.string().min(1),
});
export class AuthController {
    async login(req, res, next) {
        try {
            const data = loginSchema.parse(req.body);
            const result = await authService.login(data.email, data.password);
            res.json(result);
        }
        catch (error) {
            next(error instanceof z.ZodError ? new ValidationError('Invalid input', error.issues) : error);
        }
    }
    async validateInvitation(req, res, next) {
        try {
            const data = validateInvitationSchema.parse(req.body);
            const result = await authService.validateInvitation(data.token);
            res.json(result);
        }
        catch (error) {
            next(error instanceof z.ZodError ? new ValidationError('Invalid input', error.issues) : error);
        }
    }
    async acceptInvitation(req, res, next) {
        try {
            const data = acceptInvitationSchema.parse(req.body);
            const result = await authService.acceptInvitation(data.token, data.password);
            res.status(201).json(result);
        }
        catch (error) {
            next(error instanceof z.ZodError ? new ValidationError('Invalid input', error.issues) : error);
        }
    }
}
export const authController = new AuthController();
//# sourceMappingURL=auth.controller.js.map