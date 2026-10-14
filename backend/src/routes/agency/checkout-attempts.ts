import { Router } from 'express';
import { checkoutAttemptController } from '../../controllers/checkout-attempt.controller.js';

const router = Router();

router.get('/', (req, res, next) => checkoutAttemptController.list(req, res, next));
router.get('/:attemptId', (req, res, next) => checkoutAttemptController.getById(req, res, next));
router.get('/:attemptId/proof', (req, res, next) => checkoutAttemptController.getProof(req, res, next));
router.post('/:attemptId/verify', (req, res, next) => checkoutAttemptController.verify(req, res, next));
router.post('/:attemptId/reject', (req, res, next) => checkoutAttemptController.reject(req, res, next));

export default router;
