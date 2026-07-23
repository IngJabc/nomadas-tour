import { Request, Response, NextFunction } from 'express';
import { notificationService } from '../services/notification.service.js';

export class NotificationController {
  async getNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const role = req.ctx!.role;
      const agencyId = req.ctx?.agencyId ?? undefined;

      let notifications;
      if (role === 'superadmin') {
        notifications = await notificationService.getAdminNotifications();
      } else if (role === 'agency' && agencyId) {
        notifications = await notificationService.getAgencyNotifications(agencyId);
      } else {
        notifications = [];
      }

      res.json(notifications);
    } catch (error) {
      next(error);
    }
  }

  async getUnreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      const role = req.ctx!.role;
      const agencyId = req.ctx?.agencyId ?? undefined;

      const count = await notificationService.getUnreadCount(role, agencyId);
      res.json({ count });
    } catch (error) {
      next(error);
    }
  }

  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userId = req.ctx!.userId;
      const role = req.ctx!.role;
      const agencyId = req.ctx?.agencyId ?? undefined;

      await notificationService.markAsRead(id, userId, role, agencyId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.ctx!.userId;
      const role = req.ctx!.role;
      const agencyId = req.ctx?.agencyId ?? undefined;

      await notificationService.markAllAsRead(userId, role, agencyId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}

export const notificationController = new NotificationController();
