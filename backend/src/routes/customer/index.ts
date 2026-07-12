import { Router } from 'express';
import { auth, optionalAuth } from '../../middlewares/auth.js';
import { reservationController } from '../../controllers/reservation.controller.js';

const router = Router();

// Public trip info
router.get('/trips', (req, res, next) => reservationController.listTrips(req, res, next));
router.get('/trips/:tripId', (req, res, next) => reservationController.getTripWithSeats(req, res, next));
router.get('/trips/:tripId/agencies', (req, res, next) => reservationController.getAvailableAgencies(req, res, next));

// Reservation (auth optional - anonymous booking allowed)
router.post('/reservations', optionalAuth, (req, res, next) => reservationController.createReservation(req, res, next));

// Reservations for authenticated user
router.get('/reservations/my', auth, (req, res, next) => reservationController.getUserReservations(req, res, next));
router.post('/reservations/cancel', auth, (req, res, next) => reservationController.cancelUserReservation(req, res, next));

export default router;
