import type { Request, Response } from 'express';
import { activityQuerySchema } from '@cadence/shared';
import { ok } from '../../lib/response.js';
import { dashboardService } from './dashboard.service.js';

export const dashboardController = {
  async learner(req: Request, res: Response): Promise<void> {
    const dashboard = await dashboardService.learner(req.user!.id);
    ok(res, 'Dashboard retrieved', dashboard);
  },

  async admin(_req: Request, res: Response): Promise<void> {
    const dashboard = await dashboardService.admin();
    ok(res, 'Dashboard retrieved', dashboard);
  },

  /** The caller's own feed; never anyone else's. */
  async myActivity(req: Request, res: Response): Promise<void> {
    const query = activityQuerySchema.parse(req.query);
    const { items, meta } = await dashboardService.activity(query, req.user!.id);
    ok(res, 'Activity retrieved', items, meta);
  },
};
