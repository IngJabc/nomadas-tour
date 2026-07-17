import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../../controllers/auth.controller.js';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many requests, try again later' } },
});

const router = Router();

router.use(limiter);

router.post('/login', (req, res, next) => authController.login(req, res, next));
router.post('/validate-invitation', (req, res, next) => authController.validateInvitation(req, res, next));
router.post('/accept-invitation', (req, res, next) => authController.acceptInvitation(req, res, next));
router.post('/forgot-password', (req, res, next) => authController.forgotPassword(req, res, next));
router.post('/reset-password', (req, res, next) => authController.resetPassword(req, res, next));

export default router;
