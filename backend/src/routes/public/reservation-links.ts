import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { reservationLinkController } from '../../controllers/reservation-link.controller.js';

const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
});

const router = Router();

router.use(linkLimiter);
router.get('/:token', (req, res, next) =>
  reservationLinkController.publicGet(req, res, next),
);
router.post('/:token/save', (req, res, next) =>
  reservationLinkController.publicSave(req, res, next),
);

export default router;
