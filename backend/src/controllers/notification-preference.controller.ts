import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../errors/index.js';
import {
  notificationPreferenceService,
  toPublicCategories,
  toPublicPreferences,
} from '../services/notification-preference.service.js';
import { auditRequestMetadata } from '../utils/audit-metadata.js';

const updatePreferencesSchema = z
  .object({
    trip_assignments: z.boolean().optional(),
    trip_schedule_changes: z.boolean().optional(),
    trip_status_updates: z.boolean().optional(),
    trip_cancellations: z.boolean().optional(),
    trip_reminders: z.boolean().optional(),
    ops_digest: z.boolean().optional(),
    occupancy_alerts: z.boolean().optional(),
  })
  .strict();

export class NotificationPreferenceController {
  async getPreferences(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        throw new ValidationError('Agency context required');
      }

      const prefs = await notificationPreferenceService.getForAgency(agencyId);

      res.json({
        preferences: toPublicPreferences(prefs),
        categories: toPublicCategories(prefs),
      });
    } catch (error) {
      next(error);
    }
  }

  async updatePreferences(req: Request, res: Response, next: NextFunction) {
    try {
      const agencyId = req.ctx!.agencyId;
      if (!agencyId) {
        throw new ValidationError('Agency context required');
      }

      const data = updatePreferencesSchema.parse(req.body);
      if (Object.keys(data).length === 0) {
        throw new ValidationError('No preference updates provided');
      }

      const updated = await notificationPreferenceService.updateForAgency(
        agencyId,
        req.ctx!.userId,
        data,
        auditRequestMetadata(req),
      );

      res.json({
        preferences: toPublicPreferences(updated),
        categories: toPublicCategories(updated),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError('Invalid input', error.issues));
        return;
      }
      next(error);
    }
  }
}

export const notificationPreferenceController =
  new NotificationPreferenceController();
