import { Request, Response, NextFunction } from 'express';
import { reservationService } from '../services/reservation.service.js';
import { z } from 'zod';
import { ValidationError } from '../errors/index.js';
import { supabaseAdmin } from '../config/database.js';

const agencyReservationSchema = z.object({
  trip_id: z.string().uuid(),
  booker_name: z.string().min(2),
  booker_document: z.string().regex(/^\d{7,8}$/, 'Documento debe tener 7 u 8 dígitos'),
  booker_phone: z.string().optional(),
  contact_email: z.string().email('Correo electrónico inválido').optional().or(z.literal('')).nullable(),
  send_ticket_email: z.boolean().optional().default(false),
  passengers: z.array(z.object({
    seat_id: z.string().uuid(),
    name: z.string().min(2),
    document: z.string().regex(/^\d{7,8}$/, 'Documento debe tener 7 u 8 dígitos'),
    phone: z.string().optional(),
  })).min(1),
});

export class ReservationController {
  // Agency: create reservation
  async createAgencyReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const data = agencyReservationSchema.parse(req.body);
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        res.status(400).json({ error: 'Agency ID not found' });
        return;
      }
      const contactEmail = data.contact_email && data.contact_email.trim()
        ? data.contact_email.trim()
        : null;

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
        contactEmail,
        data.send_ticket_email ?? false,
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
      if (trip.status === 'archived') {
        res.status(404).json({ error: 'Trip not found' });
        return;
      }
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

  // Agency: cancel individual passenger
  async cancelPassenger(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) { res.status(400).json({ error: 'Agency ID not found' }); return; }
      const reservationId = req.params.id as string;
      const passengerId = req.params.passengerId as string;
      const result = await reservationService.cancelPassenger(reservationId, passengerId, agencyId);
      res.json(result);
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

  // ─── Boarding (exact lookup + RPC toggle) ──────────────────────────────

  async lookupPassengerByQR(req: Request, res: Response, next: NextFunction) {
    try {
      const qrCode = req.params.qrCode as string;
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) { res.status(400).json({ error: 'Agency ID not found' }); return; }
      const result = await reservationService.lookupPassengerByQR(
        qrCode,
        agencyId,
        req.ctx!.userId,
      );
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
      const result = await reservationService.toggleBoarding(
        passengerId,
        boarded,
        req.ctx!.userId,
        agencyId,
      );
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

  async unlockAllUserSeats(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await reservationService.unlockAllSeatsForUser(req.ctx!.userId);
      res.json(result);
    } catch (error) {
      next(error);
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
