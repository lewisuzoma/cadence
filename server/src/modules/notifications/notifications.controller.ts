import type { Request, Response } from 'express';
import { notificationQuerySchema } from '@cadence/shared';
import { ok } from '../../lib/response.js';
import { notificationsService } from './notifications.service.js';

/**
 * Notifications are always the caller's own.
 *
 * There is no `userId` parameter anywhere here: the id comes from
 * `req.user`, which is the same rule that keeps progress and enrollments
 * free of IDOR.
 */
export const notificationsController = {
  async list(req: Request, res: Response): Promise<void> {
    const query = notificationQuerySchema.parse(req.query);
    const { data, meta } = await notificationsService.list(req.user!.id, query);
    ok(res, 'Notifications retrieved', data, meta);
  },

  async markRead(req: Request, res: Response): Promise<void> {
    await notificationsService.markRead(req.user!.id, req.params.id!);
    const unreadCount = await notificationsService.unreadCount(req.user!.id);
    ok(res, 'Notification marked as read', { unreadCount });
  },

  async markAllRead(req: Request, res: Response): Promise<void> {
    const updated = await notificationsService.markAllRead(req.user!.id);
    ok(res, 'All notifications marked as read', { updated, unreadCount: 0 });
  },
};
