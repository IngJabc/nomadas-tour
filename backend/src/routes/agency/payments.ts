import { Router } from 'express';
import { paymentController } from '../../controllers/payment.controller.js';

const router = Router();

router.get('/', (req, res, next) => paymentController.list(req, res, next));
router.get('/:paymentId', (req, res, next) => paymentController.getById(req, res, next));
router.get('/:paymentId/proof', (req, res, next) => paymentController.getProof(req, res, next));
router.post('/:paymentId/verify', (req, res, next) => paymentController.verify(req, res, next));
router.post('/:paymentId/reject', (req, res, next) => paymentController.reject(req, res, next));

export default router;
