import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { authorize } from "../../middlewares/authorize.js";
import { superadminController } from "../../controllers/superadmin.controller.js";
import { reservationController } from "../../controllers/reservation.controller.js";

const router = Router();

router.use(auth, authorize("superadmin"));

// Dashboard
router.get("/dashboard", (req, res, next) =>
  superadminController.getDashboard(req, res, next)
);

// Agencies
router.get("/agencies", (req, res, next) =>
  superadminController.listAgencies(req, res, next)
);
router.get("/agencies/:id", (req, res, next) =>
  superadminController.getAgency(req, res, next)
);
router.post("/agencies", (req, res, next) =>
  superadminController.createAgency(req, res, next)
);
router.patch("/agencies/:id", (req, res, next) =>
  superadminController.updateAgency(req, res, next)
);

// Routes
router.get("/routes", (req, res, next) =>
  superadminController.listRoutes(req, res, next)
);
router.post("/routes", (req, res, next) =>
  superadminController.createRoute(req, res, next)
);
router.patch("/routes/:id", (req, res, next) =>
  superadminController.updateRoute(req, res, next)
);
router.delete("/routes/:id", (req, res, next) =>
  superadminController.deleteRoute(req, res, next)
);

// Trips
router.get("/trips", (req, res, next) =>
  superadminController.listTrips(req, res, next)
);
router.get("/trips/:id", (req, res, next) =>
  superadminController.getTrip(req, res, next)
);
router.post("/trips", (req, res, next) =>
  superadminController.createTrip(req, res, next)
);
router.patch("/trips/:id", (req, res, next) =>
  superadminController.updateTrip(req, res, next)
);
router.delete("/trips/:id", (req, res, next) =>
  superadminController.deleteTrip(req, res, next)
);
router.patch("/trips/:id/status", (req, res, next) =>
  superadminController.updateTripStatus(req, res, next)
);

// Reservations
router.get("/reservations", (req, res, next) =>
  reservationController.getAllReservations(req, res, next)
);
router.get("/reservations/tree", (req, res, next) =>
  reservationController.getPassengerTree(req, res, next)
);
router.get("/reservations/:id", (req, res, next) =>
  reservationController.getReservation(req, res, next)
);
router.patch("/reservations/:id/status", (req, res, next) =>
  reservationController.updateReservationStatus(req, res, next)
);

// Invitations
router.get("/invitations", (req, res, next) =>
  superadminController.listInvitations(req, res, next)
);

export default router;
