import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { superadminService } from "../services/superadmin.service.js";
import { ValidationError } from "../errors/index.js";

/**
 * Cambio de estado de un viaje desde el panel de agencia.
 *
 * REGLA: la agencia solo puede COMPLETAR un viaje que le pertenezca en
 * exclusiva. `cancelled` no es un valor aceptado aqui (el schema lo
 * rechaza) y el service lo vuelve a bloquear; la cancelación de un
 * viaje entero es superadmin-only. La cancelación individual de una
 * reserva vive en otro endpoint (`PATCH /reservations/:id/cancel`).
 *
 * El actor sale SIEMPRE de `req.ctx` (sesión + `public.users`), nunca
 * del body.
 */
const updateTripStatusSchema = z.object({
  status: z.enum(["completed"]),
});

/**
 * AS-TRIP-003 — alta de viaje por la agencia.
 *
 * Schema **strict**: cualquier campo que no esté listado aqui se rechaza
 * con 400. En particular NO existen `agency_ids` / `agency_id` / `status`:
 * la agencia no puede elegir a quién se asigna el viaje, crear viajes
 * compartidos ni introducir estados no soportados. La asignación se
 * deriva en el server desde `req.ctx`.
 */
export const createTripSchema = z
  .object({
    route_id: z.string().uuid(),
    departure_time: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/),
    vehicle_type: z.enum(["bus", "kia"]),
    /** Centavos COP (trips.seat_price). Omitir = no publicar precio. */
    seat_price: z.number().int().min(0).max(2_147_483_647).optional(),
  })
  .strict();

export class AgencyTripController {
  async updateTripStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateTripStatusSchema.parse(req.body);
      const result = await superadminService.updateTripStatus(
        req.params.tripId as string,
        data.status,
        req.ctx!,
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

  /**
   * AS-TRIP-003 — `POST /api/agency/trips`. Crea un viaje asignado en
   * exclusiva a la agencia autenticada. El `agency_id` nunca se acepta
   * del body: sale de `req.ctx`.
   */
  async createTrip(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createTripSchema.parse(req.body);
      const trip = await superadminService.createAgencyTrip(req.ctx!, data);
      res.status(201).json(trip);
    } catch (error) {
      next(
        error instanceof z.ZodError
          ? new ValidationError("Invalid input", (error as any).issues)
          : error
      );
    }
  }

  /**
   * `GET /api/agency/routes` — catálogo global de rutas activas para el
   * selector de viaje. Solo lectura: la agencia no puede crear, editar ni
   * desactivar rutas (eso sigue siendo superadmin-only).
   */
  async listRoutes(_req: Request, res: Response, next: NextFunction) {
    try {
      const routes = await superadminService.listRoutesCatalog();
      res.json(routes);
    } catch (error) {
      next(error);
    }
  }
}

export const agencyTripController = new AgencyTripController();
