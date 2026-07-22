import { Router } from 'express';
import { auth } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { tenant } from '../../middlewares/tenant.js';
import { reservationController } from '../../controllers/reservation.controller.js';

const router = Router();

router.use(auth, authorize('agency'), tenant);

router.get('/dashboard', (req, res, next) => reservationController.getAgencyDashboard(req, res, next));
router.get('/trips', (req, res, next) => reservationController.getAgencyTrips(req, res, next));
router.get('/trips/:tripId', (req, res, next) => reservationController.getAgencyTripById(req, res, next));
router.get('/trips/:tripId/passengers', (req, res, next) => reservationController.getAgencyTripPassengers(req, res, next));
router.get('/reservations', (req, res, next) => reservationController.getAgencyReservations(req, res, next));
router.get('/reservations/:id', (req, res, next) => reservationController.getAgencyReservationById(req, res, next));
router.post('/reservations', (req, res, next) => reservationController.createAgencyReservation(req, res, next));
router.post('/reservations/board', (req, res, next) => reservationController.boardPassenger(req, res, next));
router.post('/reservations/cancel', (req, res, next) => reservationController.cancelReservation(req, res, next));
router.patch('/reservations/:id/cancel', (req, res, next) => reservationController.cancelAgencyReservation(req, res, next));
router.patch('/reservations/:id/passengers/:passengerId/cancel', (req, res, next) => reservationController.cancelPassenger(req, res, next));

// Seat locking (realtime)
router.post('/seats/lock', (req, res, next) => reservationController.lockSeat(req, res, next));
router.post('/seats/unlock', (req, res, next) => reservationController.unlockSeat(req, res, next));
router.post('/seats/unlock-all', (req, res, next) => reservationController.unlockAllSeats(req, res, next));
router.post('/seats/unlock-all-user', (req, res, next) => reservationController.unlockAllUserSeats(req, res, next));

// Scanner endpoints (boarding parcial con QR)
router.post('/scanner/lookup', (req, res, next) => reservationController.lookupReservation(req, res, next));
router.post('/scanner/board', (req, res, next) => reservationController.boardPassengers(req, res, next));

// Sprint 13 — Boarding por pasajero individual
router.get('/boarding/:qrCode', (req, res, next) => reservationController.lookupPassengerByQR(req, res, next));
router.patch('/boarding/:passengerId', (req, res, next) => reservationController.toggleBoarding(req, res, next));

// Expired lock cleanup (internal)
router.post('/seats/release-expired', (req, res, next) => reservationController.releaseExpiredLocks(req, res, next));

export default router;
