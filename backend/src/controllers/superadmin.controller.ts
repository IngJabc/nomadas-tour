import { Request, Response, NextFunction } from "express";
import { superadminService } from "../services/superadmin.service.js";
import { z } from "zod";
import { ValidationError } from "../errors/index.js";

const createAgencySchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
});

const updateAgencySchema = z.object({
  name: z.string().min(2).optional(),
  status: z.enum(["active", "inactive", "pending"]).optional(),
});

const createRouteSchema = z.object({
  origin: z.string().min(2),
  destination: z.string().min(2),
});

const updateRouteSchema = z.object({
  origin: z.string().min(2).optional(),
  destination: z.string().min(2).optional(),
});

const createTripSchema = z.object({
  route_id: z.string().uuid(),
  departure_time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/),
  vehicle_type: z.enum(["bus", "kia"]),
  agency_ids: z.array(z.string().uuid()).min(1),
});

export class SuperadminController {
  // Agencies
  async listAgencies(req: Request, res: Response, next: NextFunction) {
    try {
      const agencies = await superadminService.listAgencies();
      res.json(agencies);
    } catch (error) {
      next(error);
    }
  }

  async getAgency(req: Request, res: Response, next: NextFunction) {
    try {
      const agency = await superadminService.getAgency(req.params.id as string);
      res.json(agency);
    } catch (error) {
      next(error);
    }
  }

  async createAgency(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createAgencySchema.parse(req.body);
      const agency = await superadminService.createAgency(
        data.name,
        data.email,
        req.ctx!.userId
      );
      res.status(201).json(agency);
    } catch (error) {
      next(
        error instanceof z.ZodError
          ? new ValidationError("Invalid input", (error as any).issues)
          : error
      );
    }
  }

  async updateAgency(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateAgencySchema.parse(req.body);
      const agency = await superadminService.updateAgency(
        req.params.id as string,
        data
      );
      res.json(agency);
    } catch (error) {
      next(
        error instanceof z.ZodError
          ? new ValidationError("Invalid input", (error as any).issues)
          : error
      );
    }
  }

  // Routes
  async listRoutes(req: Request, res: Response, next: NextFunction) {
    try {
      const routes = await superadminService.listRoutes();
      res.json(routes);
    } catch (error) {
      next(error);
    }
  }

  async createRoute(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createRouteSchema.parse(req.body);
      const route = await superadminService.createRoute(
        data.origin,
        data.destination
      );
      res.status(201).json(route);
    } catch (error) {
      next(
        error instanceof z.ZodError
          ? new ValidationError("Invalid input", (error as any).issues)
          : error
      );
    }
  }

  async updateRoute(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateRouteSchema.parse(req.body);
      const route = await superadminService.updateRoute(
        req.params.id as string,
        data
      );
      res.json(route);
    } catch (error) {
      next(
        error instanceof z.ZodError
          ? new ValidationError("Invalid input", (error as any).issues)
          : error
      );
    }
  }

  async deleteRoute(req: Request, res: Response, next: NextFunction) {
    try {
      await superadminService.deleteRoute(req.params.id as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // Trips
  async updateTrip(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createTripSchema.parse(req.body);
      const trip = await superadminService.updateTrip(
        req.params.id as string,
        data.route_id,
        data.departure_time,
        data.vehicle_type,
        data.agency_ids
      );
      res.json(trip);
    } catch (error) {
      next(
        error instanceof z.ZodError
          ? new ValidationError("Invalid input", (error as any).issues)
          : error
      );
    }
  }

  async createTrip(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createTripSchema.parse(req.body);
      const trip = await superadminService.createTrip(
        data.route_id,
        data.departure_time,
        data.vehicle_type,
        data.agency_ids,
        req.ctx!.userId
      );
      res.status(201).json(trip);
    } catch (error) {
      next(
        error instanceof z.ZodError
          ? new ValidationError("Invalid input", (error as any).issues)
          : error
      );
    }
  }

  async listTrips(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 12));
      const filters: { status?: string; route_id?: string; agency_id?: string; search?: string; departure_date?: string } = {};
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.route_id) filters.route_id = req.query.route_id as string;
      if (req.query.agency_id) filters.agency_id = req.query.agency_id as string;
      if (req.query.search) filters.search = req.query.search as string;
      if (req.query.departure_date) filters.departure_date = req.query.departure_date as string;
      const trips = await superadminService.listTrips(page, limit, filters);
      res.json(trips);
    } catch (error) {
      next(error);
    }
  }

  async getTrip(req: Request, res: Response, next: NextFunction) {
    try {
      const trip = await superadminService.getTrip(req.params.id as string);
      res.json(trip);
    } catch (error) {
      next(error);
    }
  }

  async deleteTrip(req: Request, res: Response, next: NextFunction) {
    try {
      await superadminService.deleteTrip(req.params.id as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // Trip status (complete / cancel)
  async updateTripStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const data = z
        .object({ status: z.enum(["completed", "cancelled"]) })
        .parse(req.body);
      const result = await superadminService.updateTripStatus(
        req.params.id as string,
        data.status
      );
      res.json(result);
    } catch (error) {
      next(
        error instanceof z.ZodError
          ? new ValidationError("Invalid input", (error as any).issues)
          : error
      );
    }
  }

  // Invitations
  async listInvitations(req: Request, res: Response, next: NextFunction) {
    try {
      const invitations = await superadminService.listInvitations();
      res.json(invitations);
    } catch (error) {
      next(error);
    }
  }

  // Dashboard
  async getDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const dashboard = await superadminService.getDashboard();
      res.json(dashboard);
    } catch (error) {
      next(error);
    }
  }
}

export const superadminController = new SuperadminController();
