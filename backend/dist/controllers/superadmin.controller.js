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
    async listAgencies(req, res, next) {
        try {
            const agencies = await superadminService.listAgencies();
            res.json(agencies);
        }
        catch (error) {
            next(error);
        }
    }
    async getAgency(req, res, next) {
        try {
            const agency = await superadminService.getAgency(req.params.id);
            res.json(agency);
        }
        catch (error) {
            next(error);
        }
    }
    async createAgency(req, res, next) {
        try {
            const data = createAgencySchema.parse(req.body);
            const agency = await superadminService.createAgency(data.name, data.email, req.ctx.userId);
            res.status(201).json(agency);
        }
        catch (error) {
            next(error instanceof z.ZodError
                ? new ValidationError("Invalid input", error.issues)
                : error);
        }
    }
    async updateAgency(req, res, next) {
        try {
            const data = updateAgencySchema.parse(req.body);
            const agency = await superadminService.updateAgency(req.params.id, data);
            res.json(agency);
        }
        catch (error) {
            next(error instanceof z.ZodError
                ? new ValidationError("Invalid input", error.issues)
                : error);
        }
    }
    // Routes
    async listRoutes(req, res, next) {
        try {
            const routes = await superadminService.listRoutes();
            res.json(routes);
        }
        catch (error) {
            next(error);
        }
    }
    async createRoute(req, res, next) {
        try {
            const data = createRouteSchema.parse(req.body);
            const route = await superadminService.createRoute(data.origin, data.destination);
            res.status(201).json(route);
        }
        catch (error) {
            next(error instanceof z.ZodError
                ? new ValidationError("Invalid input", error.issues)
                : error);
        }
    }
    async updateRoute(req, res, next) {
        try {
            const data = updateRouteSchema.parse(req.body);
            const route = await superadminService.updateRoute(req.params.id, data);
            res.json(route);
        }
        catch (error) {
            next(error instanceof z.ZodError
                ? new ValidationError("Invalid input", error.issues)
                : error);
        }
    }
    async deleteRoute(req, res, next) {
        try {
            await superadminService.deleteRoute(req.params.id);
            res.status(204).send();
        }
        catch (error) {
            next(error);
        }
    }
    // Trips
    async updateTrip(req, res, next) {
        try {
            const data = createTripSchema.parse(req.body);
            const trip = await superadminService.updateTrip(req.params.id, data.route_id, data.departure_time, data.vehicle_type, data.agency_ids);
            res.json(trip);
        }
        catch (error) {
            next(error instanceof z.ZodError
                ? new ValidationError("Invalid input", error.issues)
                : error);
        }
    }
    async createTrip(req, res, next) {
        try {
            const data = createTripSchema.parse(req.body);
            const trip = await superadminService.createTrip(data.route_id, data.departure_time, data.vehicle_type, data.agency_ids, req.ctx.userId);
            res.status(201).json(trip);
        }
        catch (error) {
            next(error instanceof z.ZodError
                ? new ValidationError("Invalid input", error.issues)
                : error);
        }
    }
    async listTrips(req, res, next) {
        try {
            const trips = await superadminService.listTrips();
            res.json(trips);
        }
        catch (error) {
            next(error);
        }
    }
    async getTrip(req, res, next) {
        try {
            const trip = await superadminService.getTrip(req.params.id);
            res.json(trip);
        }
        catch (error) {
            next(error);
        }
    }
    async deleteTrip(req, res, next) {
        try {
            await superadminService.deleteTrip(req.params.id);
            res.status(204).send();
        }
        catch (error) {
            next(error);
        }
    }
    // Trip status (complete / cancel)
    async updateTripStatus(req, res, next) {
        try {
            const data = z
                .object({ status: z.enum(["completed", "cancelled"]) })
                .parse(req.body);
            const result = await superadminService.updateTripStatus(req.params.id, data.status);
            res.json(result);
        }
        catch (error) {
            next(error instanceof z.ZodError
                ? new ValidationError("Invalid input", error.issues)
                : error);
        }
    }
    // Invitations
    async listInvitations(req, res, next) {
        try {
            const invitations = await superadminService.listInvitations();
            res.json(invitations);
        }
        catch (error) {
            next(error);
        }
    }
    // Dashboard
    async getDashboard(req, res, next) {
        try {
            const dashboard = await superadminService.getDashboard();
            res.json(dashboard);
        }
        catch (error) {
            next(error);
        }
    }
}
export const superadminController = new SuperadminController();
//# sourceMappingURL=superadmin.controller.js.map