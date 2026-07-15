import { Request, Response, NextFunction } from 'express';
import { reservationService } from '../services/reservation.service.js';
import { z } from 'zod';
import { ValidationError } from '../errors/index.js';
import { supabaseAdmin } from '../config/database.js';

const createReservationSchema = z.object({
  trip_id: z.string().uuid(),
  customer_name: z.string().min(2),
  passenger_cedula: z.string().min(5),
  phone: z.string().optional(),
  seat_codes: z.array(z.string()).min(1),
});

const cancelReservationSchema = z.object({
  trip_id: z.string().uuid(),
  transaction_id: z.string().min(1),
});

const boardPassengerSchema = z.object({
  trip_id: z.string().uuid(),
  qr_code: z.string().min(1),
});

const agencyReservationSchema = z.object({
  trip_id: z.string().uuid(),
  booker_name: z.string().min(2),
  booker_document: z.string().min(5),
  booker_phone: z.string().optional(),
  passengers: z.array(z.object({
    seat_id: z.string().uuid(),
    name: z.string().min(2),
    document: z.string().min(5),
    phone: z.string().optional(),
  })).min(1),
});

export class ReservationController {
  async listTrips(req: Request, res: Response, next: NextFunction) {
    try {
      const trips = await reservationService.listActiveTrips();
      res.json(trips);
    } catch (error) {
      next(error);
    }
  }

  async getTripWithSeats(req: Request, res: Response, next: NextFunction) {
    try {
      const trip = await reservationService.getTripWithSeats(req.params.tripId as string);
      res.json(trip);
    } catch (error) {
      next(error);
    }
  }

  async getAvailableAgencies(req: Request, res: Response, next: NextFunction) {
    try {
      const agencies = await reservationService.getAvailableAgencies(req.params.tripId as string);
      res.json(agencies);
    } catch (error) {
      next(error);
    }
  }

  async createReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createReservationSchema.parse(req.body);
      const result = await reservationService.createReservation(
        data.trip_id,
        data.customer_name,
        data.passenger_cedula,
        data.phone || null,
        data.seat_codes,
        req.ctx?.userId || null,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', (error as any).issues) : error);
    }
  }

  async cancelReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = cancelReservationSchema.parse(req.body);
      const result = await reservationService.cancelReservation(
        data.trip_id,
        data.transaction_id,
        req.ctx?.agencyId || null,
        req.ctx?.role === 'superadmin',
      );
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', (error as any).issues) : error);
    }
  }

  async boardPassenger(req: Request, res: Response, next: NextFunction) {
    try {
      const data = boardPassengerSchema.parse(req.body);
      const result = await reservationService.boardPassenger(
        data.trip_id,
        data.qr_code,
        req.ctx!.userId,
        req.ctx?.agencyId || null,
        req.ctx?.role === 'superadmin',
      );
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', (error as any).issues) : error);
    }
  }

  // Agency: create reservation
  async createAgencyReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = agencyReservationSchema.parse(req.body);
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: 'Agency ID not found' });
        return;
      }
      const result = await reservationService.createAgencyReservation(
        data.trip_id,
        data.booker_name,
        data.booker_document,
        data.booker_phone || null,
        data.passengers.map(p => ({
          seat_id: p.seat_id,
          name: p.name,
          document: p.document,
          phone: p.phone || null,
        })),
        agencyId,
        req.ctx!.userId,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', (error as any).issues) : error);
    }
  }

  // Agency: get trip with seats (only if assigned)
  async getAgencyTripById(req: Request, res: Response, next: NextFunction) {
    try {
      const tripId = req.params.tripId as string;
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: 'Agency ID not found' });
        return;
      }
      const trip = await reservationService.getTripWithSeats(tripId);
      const { data: assignment } = await supabaseAdmin
        .from('trip_agencies')
        .select('agency_id')
        .eq('trip_id', tripId)
        .eq('agency_id', agencyId)
        .maybeSingle();
      if (!assignment) {
        res.status(403).json({ error: 'Trip not assigned to this agency' });
        return;
      }
      res.json(trip);
    } catch (error) {
      next(error);
    }
  }

  // Agency: own reservations list
  async getAgencyReservations(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: 'Agency ID not found' });
        return;
      }
      const reservations = await reservationService.getAgencyReservations(agencyId);
      res.json(reservations);
    } catch (error) {
      next(error);
    }
  }

  // Agency: reservation detail
  async getAgencyReservationById(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: 'Agency ID not found' });
        return;
      }
      const id = req.params.id as string;
      const reservation = await reservationService.getAgencyReservationById(id, agencyId);
      res.json(reservation);
    } catch (error) {
      next(error);
    }
  }

  // Agency: cancel reservation
  async cancelAgencyReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: 'Agency ID not found' });
        return;
      }
      const id = req.params.id as string;
      const result = await reservationService.cancelAgencyReservation(id, agencyId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Agency: own reservations (legacy)
  // Customer: cancel own reservation
  async cancelUserReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = cancelReservationSchema.parse(req.body);
      const result = await reservationService.cancelUserReservation(
        data.trip_id,
        data.transaction_id,
        req.ctx!.userId,
      );
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', (error as any).issues) : error);
    }
  }

  // Customer: own reservations
  async getUserReservations(req: Request, res: Response, next: NextFunction) {
    try {
      const reservations = await reservationService.getUserReservations(req.ctx!.userId);
      res.json(reservations);
    } catch (error) {
      next(error);
    }
  }

  // Superadmin: all reservations (paginated)
  async getAllReservations(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const result = await reservationService.getAllReservations({
        page,
        limit,
        status: req.query.status as string | undefined,
        search: req.query.search as string | undefined,
        agency_id: req.query.agency_id as string | undefined,
        trip_id: req.query.trip_id as string | undefined,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Agency: trip passenger manifest
  async getAgencyTripPassengers(req: Request, res: Response, next: NextFunction) {
    try {
      const tripId = req.params.tripId as string;
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: 'Agency ID not found' });
        return;
      }
      const result = await reservationService.getAgencyTripPassengers(tripId, agencyId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Agency trips (Sprint 11.1)
  async getAgencyTrips(req: Request, res: Response, next: NextFunction) {
    try {
      let agencyId = req.ctx!.agencyId;
      if (!agencyId && req.ctx?.userId) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('agency_id')
          .eq('id', req.ctx.userId)
          .single();
        if (user?.agency_id) agencyId = user.agency_id;
      }
      if (!agencyId) {
        res.status(400).json({ error: 'Agency ID not found' });
        return;
      }
      const trips = await reservationService.getAgencyTrips(agencyId);
      res.json(trips);
    } catch (error) {
      next(error);
    }
  }

  // ---------- Scanner / Boarding parcial ----------

  async lookupReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const { qr_code } = z.object({ qr_code: z.string().min(1) }).parse(req.body);
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: 'Agency ID not found' });
        return;
      }
      const result = await reservationService.lookupReservationByQR(qr_code, agencyId);
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', (error as any).issues) : error);
    }
  }

  async boardPassengers(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = z.object({
        qr_code: z.string().min(1),
        seat_ids: z.array(z.string().uuid()).min(1),
      });
      const data = schema.parse(req.body);
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: 'Agency ID not found' });
        return;
      }
      const result = await reservationService.boardPassengers(
        data.qr_code,
        data.seat_ids,
        req.ctx!.userId,
        agencyId,
      );
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', (error as any).issues) : error);
    }
  }

  // ─── Sprint 13 — Boarding por pasajero individual ──────────────────────

  async lookupPassengerByQR(req: Request, res: Response, next: NextFunction) {
    try {
      const qrCode = req.params.qrCode as string;
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) { res.status(400).json({ error: 'Agency ID not found' }); return; }
      const result = await reservationService.lookupPassengerByQR(qrCode, agencyId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async toggleBoarding(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = z.object({
        boarded: z.boolean(),
      });
      const passengerId = req.params.passengerId as string;
      const { boarded } = schema.parse(req.body);
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) { res.status(400).json({ error: 'Agency ID not found' }); return; }
      const result = await reservationService.toggleBoarding(passengerId, boarded, req.ctx!.userId, agencyId);
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', (error as any).issues) : error);
    }
  }

  // ─── Seat locking ──────────────────────────────────────────────────────

  async lockSeat(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = z.object({
        trip_id: z.string().uuid(),
        seat_id: z.string().uuid(),
      });
      const data = schema.parse(req.body);
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) { res.status(400).json({ error: 'Agency ID not found' }); return; }
      const result = await reservationService.lockSeat(data.trip_id, data.seat_id, req.ctx!.userId, agencyId);
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', (error as any).issues) : error);
    }
  }

  async unlockSeat(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = z.object({
        trip_id: z.string().uuid(),
        seat_id: z.string().uuid(),
      });
      const data = schema.parse(req.body);
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) { res.status(400).json({ error: 'Agency ID not found' }); return; }
      const result = await reservationService.unlockSeat(data.trip_id, data.seat_id, req.ctx!.userId, agencyId);
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', (error as any).issues) : error);
    }
  }

  async unlockAllSeats(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = z.object({
        trip_id: z.string().uuid(),
      });
      const data = schema.parse(req.body);
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) { res.status(400).json({ error: 'Agency ID not found' }); return; }
      const result = await reservationService.unlockAllSeats(data.trip_id, req.ctx!.userId, agencyId);
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', (error as any).issues) : error);
    }
  }

  async releaseExpiredLocks(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await reservationService.releaseExpiredLocks();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Superadmin: reservation detail
  async getReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const reservation = await reservationService.getReservationById(id);
      res.json(reservation);
    } catch (error) {
      next(error);
    }
  }

  // Superadmin: update reservation status
  async updateReservationStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { status } = z.object({ status: z.string().min(1) }).parse(req.body);
      const result = await reservationService.updateReservationStatus(id, status);
      res.json(result);
    } catch (error) {
      next(error instanceof z.ZodError ? new ValidationError('Invalid input', (error as any).issues) : error);
    }
  }

  // Superadmin: passenger explorer tree (Route → Trip → Passengers)
  async getPassengerTree(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await reservationService.getPassengerTree({
        status: req.query.status as string | undefined,
        route_id: req.query.route_id as string | undefined,
        trip_id: req.query.trip_id as string | undefined,
        agency_id: req.query.agency_id as string | undefined,
        date: req.query.date as string | undefined,
        search: req.query.search as string | undefined,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // Agency dashboard
  async getAgencyDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      let agencyId = req.ctx!.agencyId;
      if (!agencyId && req.ctx?.userId) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('agency_id')
          .eq('id', req.ctx.userId)
          .single();
        if (user?.agency_id) agencyId = user.agency_id;
      }
      if (!agencyId) {
        res.status(400).json({ error: 'Agency ID not found' });
        return;
      }
      const dashboard = await reservationService.getAgencyDashboard(agencyId);
      res.json(dashboard);
    } catch (error) {
      next(error);
    }
  }
}

export const reservationController = new ReservationController();
