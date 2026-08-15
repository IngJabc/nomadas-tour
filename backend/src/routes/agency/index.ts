import { Router } from 'express';
import { auth } from '../../middlewares/auth.js';
import { authorize } from '../../middlewares/authorize.js';
import { tenant } from '../../middlewares/tenant.js';
import { reservationController } from '../../controllers/reservation.controller.js';
import { notificationController } from '../../controllers/notification.controller.js';
import { notificationPreferenceController } from '../../controllers/notification-preference.controller.js';
import { agencySettingsController } from '../../controllers/agency-settings.controller.js';
import { auditController } from '../../controllers/audit.controller.js';

const router = Router();

router.use(auth, authorize('agency'), tenant);

router.get('/dashboard', (req, res, next) => reservationController.getAgencyDashboard(req, res, next));
router.get('/trips', (req, res, next) => reservationController.getAgencyTrips(req, res, next));
router.get('/trips/:tripId', (req, res, next) => reservationController.getAgencyTripById(req, res, next));
router.get('/trips/:tripId/passengers', (req, res, next) => reservationController.getAgencyTripPassengers(req, res, next));
router.get('/reservations', (req, res, next) => reservationController.getAgencyReservations(req, res, next));
router.get('/reservations/:id', (req, res, next) => reservationController.getAgencyReservationById(req, res, next));
router.post('/reservations', (req, res, next) => reservationController.createAgencyReservation(req, res, next));
router.patch('/reservations/:id/cancel', (req, res, next) => reservationController.cancelAgencyReservation(req, res, next));
router.patch('/reservations/:id/passengers/:passengerId/cancel', (req, res, next) => reservationController.cancelPassenger(req, res, next));

// Seat locking (realtime)
router.post('/seats/lock', (req, res, next) => reservationController.lockSeat(req, res, next));
router.post('/seats/unlock', (req, res, next) => reservationController.unlockSeat(req, res, next));
router.post('/seats/unlock-all', (req, res, next) => reservationController.unlockAllSeats(req, res, next));
router.post('/seats/unlock-all-user', (req, res, next) => reservationController.unlockAllUserSeats(req, res, next));

// Boarding — sole agency surface (lookup exact + toggle via RPC)
router.get('/boarding/:qrCode', (req, res, next) => reservationController.lookupPassengerByQR(req, res, next));
router.patch('/boarding/:passengerId', (req, res, next) => reservationController.toggleBoarding(req, res, next));

// Expired lock cleanup (internal)
router.post('/seats/release-expired', (req, res, next) => reservationController.releaseExpiredLocks(req, res, next));

// Notifications
router.get('/notifications', (req, res, next) => notificationController.getNotifications(req, res, next));
router.get('/notifications/unread-count', (req, res, next) => notificationController.getUnreadCount(req, res, next));
router.patch('/notifications/:id/read', (req, res, next) => notificationController.markAsRead(req, res, next));
router.patch('/notifications/read-all', (req, res, next) => notificationController.markAllAsRead(req, res, next));

// Notification preferences
router.get('/notification-preferences', (req, res, next) =>
  notificationPreferenceController.getPreferences(req, res, next),
);
router.patch('/notification-preferences', (req, res, next) =>
  notificationPreferenceController.updatePreferences(req, res, next),
);

// Agency branding settings (tenant identity remains in public.agencies)
router.get('/settings/branding', (req, res, next) =>
  agencySettingsController.getBranding(req, res, next),
);
router.patch('/settings/branding', (req, res, next) =>
  agencySettingsController.updateBranding(req, res, next),
);
router.post('/settings/logo', (req, res, next) =>
  agencySettingsController.uploadLogo(req, res, next),
);

// Audit trail (F5-002 — read-only)
router.get('/audit', (req, res, next) =>
  auditController.getAgencyAudit(req, res, next),
);

export default router;
