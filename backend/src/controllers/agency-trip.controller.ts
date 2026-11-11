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
}

export const agencyTripController = new AgencyTripController();
